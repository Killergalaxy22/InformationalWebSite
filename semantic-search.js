// semantic-search.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

// Разрешаем использование кэша браузера для хранения ONNX моделей
env.allowLocalModels = false;
env.useBrowserCache = true; 

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
            // 1. Удаляем любые HTML-теги (если они попали в текст как строки)
            let cleanDoc = doc.replace(/<\/?[^>]+(>|$)/g, '');
            // 2. Удаляем маркеры списков в начале строки
            cleanDoc = cleanDoc.replace(/^\s*(\d+[\.\)]|[•\-\*\◦\▪])\s+/g, '');
            // 3. Очищаем от лишних пробелов
            return cleanDoc.replace(/\s+/g, ' ').trim();
        })
        .filter(doc => doc.length >= 10 && /\p{L}/u.test(doc));
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
        let sourceElement = doc.querySelector('body > div.container > main > article') || doc.body;
        
        // Оптимизированный нативный парсинг: клонируем узел для безопасной работы с DOM
        const clone = sourceElement.cloneNode(true);
        const blockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'div', 'section', 'article', 'aside', 'header', 'footer', 'figcaption', 'tr', 'ul', 'ol', 'dl', 'dt', 'dd'];
        
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
    
    updateStatus('Загрузка нейросетей (WebGPU)...');
    // Загрузка и автоматическое кэширование моделей в Cache Storage браузера
    extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { device: 'webgpu' });
    qaPipeline = await pipeline('question-answering', 'onnx-community/xlm-roberta-base-squad2-distilled-ONNX', { device: 'webgpu' });

    const resources = window.resources || [];
    
    for (const res of resources) {
        const exists = await window.semanticDB.hasArticle(res.id);
        if (!exists) {
            updateStatus(`Индексирование: ${res.title.substring(0, 20)}...`);
            const text = await fetchArticleText(res);
            const chunks = chunkText(text);
            
            if (chunks.length > 0) {
                const embeddings = [];
                for (const chunk of chunks) {
                    const output = await extractor(chunk, { pooling: 'mean', normalize: true });
                    embeddings.push(Array.from(output.data));
                }
                await window.semanticDB.saveChunks(res.id, chunks, embeddings);
            }
        }
    }
    
    updateStatus('Готово!', true);
    setTimeout(() => updateStatus('', false), 2000);

    // Проверяем, был ли URL запрос при загрузке
    const q = window.getQueryParam();
    if (q) {
        document.getElementById('searchInput').value = q;
        window.performSearch();
    }
}

// Переопределяем глобальную функцию поиска
window.performSearch = async function(targetArticleId = null) {
    const queryRaw = document.getElementById('searchInput').value;
    const query = queryRaw.trim();
    
    window.setQueryParam(queryRaw);

    if (!query) {
        window.renderResources(window.resources || []);
        document.getElementById('resultsTitle').textContent = "Все материалы";
        const shortAnswerContainer = document.getElementById('short-answer-container');
        if (shortAnswerContainer) shortAnswerContainer.style.display = 'none';
        return;
    }

    if (!extractor) {
        alert("Нейросеть еще загружается, подождите пару секунд.");
        return;
    }

    updateStatus('Семантический поиск...', true);

    // Векторизуем запрос
    const queryOutput = await extractor(query, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(queryOutput.data);

    // Получаем все эмбеддинги (или для конкретной статьи)
    const allChunks = await window.semanticDB.getAllEmbeddings(targetArticleId);
    
    // Считаем сходство
    allChunks.forEach(chunk => {
        chunk.score = cosineSimilarity(queryEmbedding, chunk.vector);
    });

    // Сортируем по релевантности
    allChunks.sort((a, b) => b.score - a.score);

    // Берем топ 10 с score >= 0.3
    const topMatches = allChunks.filter(chunk => chunk.score >= 0.3).slice(0, 10);

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