// semantic-search.js
// ИСПРАВЛЕНИЕ: Переходим на Transformers.js v3 для поддержки dtype и WebGPU
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';

// Разрешаем использование кэша браузера для хранения ONNX моделей
env.allowLocalModels = false;
env.useBrowserCache = true;

// ИСПРАВЛЕНИЕ: Жестко ограничиваем WASM одним потоком. 
// По умолчанию ONNX создает до 4 потоков, дублируя память. Это снизит RAM с ~430 МБ до ~200 МБ.
env.backends.onnx.wasm.numThreads = 1;

let semanticReadyResolve;
const semanticReady = new Promise(resolve => { semanticReadyResolve = resolve; });

const statusEl = document.getElementById('semantic-status');
let extractor = null;
let qaPipeline = null;

function updateStatus(msg, show = true) {
    if (show) {
        statusEl.style.display = 'block';
        statusEl.textContent = msg;
    } else {
        statusEl.style.display = 'none';
    }
}

// Косинусное сходство (максимально оптимизированное)
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Очистка и разбиение текста на предложения/абзацы
function chunkText(rawText) {
    return rawText
        .split(/\n+/)
        .map(doc => {
            let cleanDoc = doc.replace(/<\/?[^>]+(>|$)/g, '');
            cleanDoc = cleanDoc.replace(/^\s*(\d+[\.\)]|[•\-\*\◦\▪])\s+/g, '');
            return cleanDoc.replace(/\s+/g, ' ').trim();
        })
        // ИСПРАВЛЕНИЕ: Снижаем порог длины до 5 и разрешаем цифры (для формул и констант)
        .filter(doc => doc.length >= 5 && /[\p{L}\d]/u.test(doc));
}

// Получение текста статьи (через fetch или fallback на описание)
async function fetchArticleText(resource) {
    try {
        if (!resource.file) throw new Error("No file");
        const response = await fetch(resource.file);
        if (!response.ok) throw new Error("Not found");
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Ищем по точному селектору, иначе берем body
        let sourceElement = doc.querySelector('article') || doc.querySelector('.container main') || doc.body;
        
        // Оптимизированный нативный парсинг
        const clone = sourceElement.cloneNode(true);
        // ДОБАВЛЕНО: td, th, code, pre для корректного разделения научных данных
        const blockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'div', 'section', 'article', 'tr', 'td', 'th', 'code', 'pre'];
        
        // Очищаем текст от скриптов, стилей и мусорных блоков
        clone.querySelectorAll('script, style, noscript, svg, .article-meta, .article-footer, .article-tags, .banner, aside, nav, footer').forEach(el => el.remove());
        
        // Разделяем блочные элементы переносами строк (закрытие тега = конец документа)
        clone.querySelectorAll(blockTags.join(',')).forEach(el => {
            el.insertAdjacentText('beforebegin', '\n');
            el.insertAdjacentText('afterend', '\n');
        });
        clone.querySelectorAll('br').forEach(el => el.insertAdjacentText('afterend', '\n'));
        
        return clone.textContent;
    } catch (e) {
        // Fallback, если файла нет (для демо)
        return `${resource.title}\n${resource.fullDesc}`;
    }
}

async function initSemanticSearch() {
    await window.semanticDB.init();
    
    updateStatus('Загрузка нейросетей (Оптимизация памяти)...');
    // Загрузка и автоматическое кэширование моделей в Cache Storage браузера
    // В v3 используем dtype: 'q8' (INT8). В будущем можно заменить на 'q4' (4-bit), если веса появятся на сервере.
    extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { 
        dtype: 'q8',
        device: 'wasm' // Опционально: можно сменить на 'webgpu', чтобы перенести нагрузку из RAM в видеопамять
    });
    qaPipeline = await pipeline('question-answering', 'onnx-community/xlm-roberta-base-squad2-distilled-ONNX', { 
        dtype: 'q8',
        device: 'wasm'
    });

    const resources = window.resources || [];
    
    // ПРИОРИТЕТ: Перемещаем текущую статью в начало списка, чтобы она индексировалась первой
    const currentPath = decodeURIComponent(window.location.pathname);
    const currentFile = currentPath.split('/').pop().toLowerCase() || 'index.html';
    console.log('[Semantic Search Init] Текущий путь:', currentPath, '| Файл:', currentFile);

    resources.sort((a, b) => {
        const aFile = decodeURIComponent(a.file).split('/').pop().toLowerCase();
        const bFile = decodeURIComponent(b.file).split('/').pop().toLowerCase();
        return (aFile === currentFile ? -1 : bFile === currentFile ? 1 : 0);
    });
    console.log('[Semantic Search Init] Порядок индексации ресурсов:', resources.map(r => r.file));
    
    for (const res of resources) {
        const exists = await window.semanticDB.hasArticle(res.id);
        console.log(`[Semantic Search Init] Статья "${res.title}" (ID: ${res.id}). Наличие в БД:`, exists);
        if (!exists) {
            updateStatus(`Индексирование: ${res.title.substring(0, 20)}...`);
            console.log(`[Semantic Search Init] Загрузка текста для статьи ID ${res.id}...`);
            const text = await fetchArticleText(res);
            console.log(`[Semantic Search Init] Длина полученного текста: ${text.length} символов.`);
            const chunks = chunkText(text);
            console.log(`[Semantic Search Init] Разбивка завершена. Создано фрагментов: ${chunks.length}`);
            
            if (chunks.length > 0) {
                const embeddings = [];
                for (const chunk of chunks) {
                    const output = await extractor(`passage: ${chunk}`, { pooling: 'mean', normalize: true });
                    embeddings.push(Array.from(output.data));
                    // Микро-пауза для очистки памяти сборщиком мусора и разблокировки UI
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
                await window.semanticDB.saveChunks(res.id, chunks, embeddings);
                console.log(`[Semantic Search Init] Фрагменты успешно сохранены в БД для статьи ID: ${res.id}`);
            } else {
                console.warn(`[Semantic Search Init] Предупреждение: для статьи ID: ${res.id} не найдено подходящих фрагментов для индексации.`);
            }
        }
    }
    
    updateStatus('Готово!', true);
    setTimeout(() => updateStatus('', false), 2000);
    
    // РАЗРЕШАЕМ ПОИСК
    semanticReadyResolve();

    // Проверяем, был ли URL запрос при загрузке
    const q = window.getQueryParam();
    if (q) {
        document.getElementById('searchInput').value = q;
        // Вызываем без параметров, так как performSearch теперь сам определит контекст
        window.performSearch();
    }
}

// Переопределяем глобальную функцию поиска
window.performSearch = async function(targetArticleId = null) {
    // Ждем завершения инициализации и индексации текущей статьи
    await semanticReady;

    const queryRaw = document.getElementById('searchInput').value;
    const query = queryRaw.trim();
    
    // Определяем контекст: главная или статья
    const isHomePage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
    
    // ИСПРАВЛЕНИЕ: Если поиск локальный, а переданный ID некорректен (null, undefined или <= 0), определяем его по URL
    if (!isHomePage && (targetArticleId === null || typeof targetArticleId !== 'number' || targetArticleId <= 0)) {
        const currentPath = decodeURIComponent(window.location.pathname);
        const currentFile = currentPath.split('/').pop().toLowerCase() || 'index.html';
        const article = (window.resources || []).find(r => {
            const rFile = decodeURIComponent(r.file).split('/').pop().toLowerCase();
            return rFile === currentFile;
        });
        if (article) {
            targetArticleId = article.id;
        } else {
            targetArticleId = -999; 
        }
    }

    window.setQueryParam(queryRaw);

    if (!query) {
        window.renderResources(window.resources || []);
        document.getElementById('resultsTitle').textContent = "Все материалы";
        const shortAnswerContainer = document.getElementById('short-answer-container');
        if (shortAnswerContainer) shortAnswerContainer.style.display = 'none';
        return;
    }

    if (!extractor) {
        // alert("Нейросеть еще загружается, подождите пару секунд.");
        return;
    }

    updateStatus('Семантический поиск...', true);

    // Векторизуем запрос
    console.log('[Perform Search] Векторизация поискового запроса...');
    const queryOutput = await extractor(`query: ${query}`, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(queryOutput.data);
    console.log('[Perform Search] Запрос успешно векторизован.');

    // Получаем все эмбеддинги (или для конкретной статьи)
    console.log('[Perform Search] Запрос эмбеддингов из БД для ID статьи:', targetArticleId);
    const allChunks = await window.semanticDB.getAllEmbeddings(targetArticleId);
    console.log('[Perform Search] Извлечено фрагментов из БД:', allChunks.length);
    
    // Считаем сходство
    allChunks.forEach(chunk => {
        chunk.score = cosineSimilarity(queryEmbedding, chunk.vector);
    });

    // Сортируем по релевантности
    allChunks.sort((a, b) => b.score - a.score);

    // Берем топ 10 с score >= 0.3
    const topMatches = allChunks.filter(chunk => chunk.score >= 0.3).slice(0, 10);
    console.log('[Perform Search] Количество результатов, прошедших порог (score >= 0.3):', topMatches.length);
    if (topMatches.length > 0) {
        console.log('[Perform Search] Наиболее релевантный фрагмент (score):', topMatches[0].score, 'Текст:', topMatches[0].text);
    }

    const grid = document.getElementById('resourcesGrid');
    const countSpan = document.getElementById('count');
    const shortAnswerContainer = document.getElementById('short-answer-container');

    grid.innerHTML = '';
    grid.style.display = 'block';
    countSpan.textContent = topMatches.length;
    shortAnswerContainer.style.display = 'none';
    
    // Обновляем заголовок сразу, независимо от наличия результатов
    document.getElementById('resultsTitle').textContent = `Нейропоиск: "${query}"`;

    if (topMatches.length === 0) {
        grid.innerHTML = '<p style="text-align: center;">Ничего не найдено :(</p>';
        updateStatus('', false);
        return;
    }

    // 1. МГНОВЕННЫЙ ВЫВОД: Рендерим результаты векторного поиска сразу
    topMatches.forEach(chunk => {
        const resList = window.resources || [{ id: chunk.articleId, title: "Текущая статья", file: window.location.pathname }];
        const originalRes = resList.find(r => r.id === chunk.articleId);
        if (!originalRes) return;

        const highlightUrl = `${originalRes.file}?highlight=${encodeURIComponent(chunk.text)}`;
        const row = document.createElement('div');
        row.className = 'search-result-row';
        row.innerHTML = `
            <div class="search-result-content">
                <a href="${highlightUrl}" class="search-result-title">${originalRes.title}</a>
                <div class="search-result-match">...${chunk.text}...</div>
            </div>
            <div class="search-result-score">[${(chunk.score * 100).toFixed(1)}%]</div>
        `;
        grid.appendChild(row);
    });

    document.getElementById('resultsTitle').textContent = `Нейропоиск: "${query}"`;
    updateStatus('', false);

    // 2. АСИНХРОННЫЙ ТОЧНЫЙ ОТВЕТ: Запускаем QA-модель без await, чтобы не блокировать UI
    const bestMatch = topMatches[0];
    const bestRes = window.resources.find(r => r.id === bestMatch.articleId);

    if (bestMatch.score > 0.01 && bestRes && qaPipeline) {
        qaPipeline(query, bestMatch.text).then(qaResult => {
            // Показываем краткий ответ только если уверенность строго больше 0.0%
            if (qaResult && qaResult.score > 0.01) {
                const exactAnswer = bestMatch.text.substring(qaResult.start, qaResult.end) || qaResult.answer;
                const highlightUrl = `${bestRes.file}?highlight=${encodeURIComponent(exactAnswer)}`;
                
                shortAnswerContainer.innerHTML = `
                    <strong style="color: var(--primary-color); display: block; margin-bottom: 5px;">Точный ответ (уверенность: ${(qaResult.score * 100).toFixed(1)}%):</strong>
                    <span style="font-size: 15px; font-weight: 500;">${exactAnswer}</span>
                    <br><a href="${highlightUrl}" style="font-size: 12px; color: var(--primary-color); text-decoration: underline; margin-top: 8px; display: inline-block;">Перейти к источнику (${bestRes.title})</a>
                `;
                shortAnswerContainer.style.display = 'block';
            }
        }).catch(err => console.error("QA Error:", err));
    }
};

// Запуск
initSemanticSearch();