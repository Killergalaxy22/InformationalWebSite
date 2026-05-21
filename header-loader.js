// Вставка стилей поиска (копия с главной страницы)
const searchStyles = document.createElement('style');
searchStyles.textContent = `
    .hero {
        background: linear-gradient(135deg, #e3f2fd 0%, #ffffff 100%);
        padding: 60px 20px;
        text-align: center;
        margin-bottom: 30px;
    }
    .hero h1 { margin-bottom: 20px; color: var(--text-main); font-size: 2.5em; }
    .hero p { color: var(--text-secondary); margin-bottom: 20px; }
    .search-box {
        max-width: 600px;
        margin: 0 auto;
        display: flex;
        gap: 10px;
        position: relative;
    }
    .search-input {
        flex-grow: 1;
        padding: 15px;
        border: 2px solid #dcebf7;
        border-radius: 8px;
        font-size: 16px;
        outline: none;
        transition: border-color 0.3s;
    }
    .search-input:focus { border-color: var(--primary-color); }
    .search-btn {
        padding: 15px 30px;
        background-color: var(--primary-color);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        transition: background 0.3s;
    }
    .search-btn:hover { background-color: #4a6d8f; }
    .search-result-row {
        background: var(--card-bg);
        padding: 20px;
        border-radius: 10px;
        box-shadow: var(--shadow);
        margin-bottom: 15px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 20px;
        text-align: left;
    }
    .search-result-content { flex-grow: 1; }
    .search-result-title {
        font-size: 18px;
        color: var(--primary-color);
        text-decoration: none;
        font-weight: bold;
        margin-bottom: 8px;
        display: inline-block;
    }
    .search-result-match { font-size: 14px; color: var(--text-main); }
    .search-result-score { font-weight: bold; color: var(--text-secondary); white-space: nowrap; }
    .results-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
`;
document.head.appendChild(searchStyles);

// Глобальные утилиты для работы с URL (необходимы для semantic-search.js)
window.getQueryParam = () => new URLSearchParams(window.location.search).get('q') || '';
window.setQueryParam = (q) => {
    const url = new URL(window.location.href);
    if (q && q.trim()) url.searchParams.set('q', q.trim());
    else url.searchParams.delete('q');
    history.replaceState(null, '', url.toString());
};

// Функция мгновенной подсветки и скролла без перезагрузки
window.applyHighlight = (targetText) => {
    if (!targetText) return;
    const clean = (t) => t.replace(/<\/?[^>]+(>|$)/g, '').replace(/^\s*(\d+[\.\)]|[•\-\*\◦\▪])\s+/g, '').replace(/\s+/g, ' ').trim();
    const target = clean(targetText);
    const container = document.querySelector('article') || document.body;
    const elements = Array.from(container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, div, td'));
    
    let bestMatch = null;
    for (const el of elements) {
        const elClean = clean(el.textContent);
        if (elClean.length >= 10 && (elClean.includes(target) || target.includes(elClean))) {
            if (!bestMatch || el.textContent.length < bestMatch.textContent.length) bestMatch = el;
        }
    }

    if (bestMatch) {
        bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bestMatch.style.transition = 'background-color 0.6s ease, color 0.6s ease';
        bestMatch.style.backgroundColor = '#78909c';
        bestMatch.style.color = '#fff';
        bestMatch.style.borderRadius = '4px';
        setTimeout(() => {
            bestMatch.style.backgroundColor = '';
            bestMatch.style.color = '';
        }, 2500);
    }
};

// Перехват кликов по ссылкам для предотвращения перезагрузки текущей страницы
document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const url = new URL(link.href, window.location.origin);
    // Если путь совпадает с текущим и есть параметр highlight
    if (url.pathname === window.location.pathname && url.searchParams.has('highlight')) {
        e.preventDefault();
        const highlightText = url.searchParams.get('highlight');
        
        // Обновляем URL в строке браузера без перезагрузки
        history.pushState(null, '', link.href);
        
        // Вызываем подсветку
        window.applyHighlight(highlightText);
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const components = [
        { url: '/header.html', id: 'header-placeholder' },
        { url: '/categories.html', id: 'categories-placeholder' },
        { url: '/banner.html', id: 'banner-placeholder' },
        { url: '/footer.html', id: 'footer-placeholder' }
    ];

    components.forEach(comp => {
        const placeholder = document.getElementById(comp.id);
        if (!placeholder) return; // Загружаем только если элемент есть на странице

        fetch(comp.url)
            .then(response => {
                if (!response.ok) throw new Error(`Ошибка сети при загрузке ${comp.url}`);
                return response.text();
            })
            .then(html => {
                placeholder.outerHTML = html; // Заменяем плейсхолдер чистым кодом
                
                // Инициализация часов после вставки шапки
                if (comp.id === 'header-placeholder') {
                    const clockEl = document.getElementById('clock');
                    if (clockEl) {
                        const updateClock = () => {
                            clockEl.textContent = new Date().toLocaleTimeString('ru-RU');
                        };
                        setInterval(updateClock, 1000);
                        updateClock();
                    }
                }
            })
            .catch(error => console.error(`Ошибка загрузки компонента:`, error));
    });

    // Глобальный обработчик категорий для всех страниц
    window.filterByCategory = (category) => {
        const isHomePage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
        
        if (isHomePage) {
            // Если мы на главной, вызываем локальную функцию (она будет определена в index.html)
            if (typeof window.localFilterByCategory === 'function') {
                window.localFilterByCategory(category);
            }
        } else {
            // Если мы в статье, уходим на главную с параметром категории
            window.location.href = `/?category=${encodeURIComponent(category)}`;
        }
    };

    // Автоматическая подсветка при первичной загрузке страницы
    const highlightText = new URLSearchParams(window.location.search).get('highlight');
    if (highlightText) {
        setTimeout(() => window.applyHighlight(highlightText), 600);
    }

    // --- ЛОКАЛЬНЫЙ ПОИСК ДЛЯ СТАТЕЙ ---
    const isHomePage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
    
    if (!isHomePage) {
        const container = document.querySelector('.container');
        if (container) {
            const searchSection = document.createElement('section');
            searchSection.className = 'hero';
            searchSection.innerHTML = `
                <h1>Найди знания в статье</h1>
                <p>Интеллектуальный поиск по содержанию текущего материала</p>
                <div class="search-box" role="search">
                    <input type="text" class="search-input" id="searchInput" placeholder="Введите вопрос по тексту статьи...">
                    <button class="search-btn" id="localSearchBtn">Найти</button>
                </div>
                <div id="short-answer-container" style="display: none; max-width: 600px; margin: 20px auto 0; background: #fff; padding: 15px; border-radius: 8px; box-shadow: var(--shadow); text-align: left; border-left: 4px solid var(--accent-color);"></div>
                <div id="localResults" style="margin-top: 30px; max-width: 1200px; margin-left: auto; margin-right: auto; padding: 0 20px;">
                    <div class="results-header" style="display:none;">
                        <h2 id="resultsTitle" style="font-size: 24px; color: var(--text-main);"></h2>
                        <span id="count" style="display:none;"></span>
                    </div>
                    <div id="resourcesGrid"></div>
                </div>
            `;
            // Вставляем ПЕРЕД контейнером (снаружи main)
            container.parentNode.insertBefore(searchSection, container);

            // Загрузка зависимостей
            const scripts = ['/resources.js', '/semantic-db.js', '/semantic-search.js'];
            scripts.forEach(src => {
                if (!document.querySelector(`script[src="${src}"]`)) {
                    const s = document.createElement('script');
                    s.src = src;
                    if (src.includes('search')) s.type = 'module';
                    document.head.appendChild(s);
                }
            });

            const performLocalSearch = () => {
                window.renderResources = (data) => {
                    const grid = document.getElementById('resourcesGrid');
                    if (grid) grid.innerHTML = ''; 
                };

                if (typeof window.performSearch === 'function') {
                    const currentFile = window.location.pathname.split('/').pop() || 'index.html';
                    const article = window.resources?.find(r => r.file === currentFile);
                    // Если статья не найдена в списке, передаем спец. флаг или ID, чтобы не искать по всем
                    window.performSearch(article ? article.id : (window.resources ? -1 : null));
                    document.querySelector('.results-header').style.display = 'flex';
                }
            };

            document.getElementById('localSearchBtn').addEventListener('click', performLocalSearch);
            document.getElementById('searchInput').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') performLocalSearch();
            });

            if (!document.getElementById('semantic-status')) {
                const status = document.createElement('div');
                status.id = 'semantic-status';
                status.style.cssText = 'display: none; position: fixed; bottom: 20px; right: 20px; background: var(--primary-color); color: white; padding: 12px 24px; border-radius: 8px; z-index: 9999;';
                document.body.appendChild(status);
            }
        }
    }
});