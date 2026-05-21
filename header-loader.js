// Глобальные утилиты для работы с URL (необходимы для semantic-search.js)
window.getQueryParam = () => new URLSearchParams(window.location.search).get('q') || '';
window.setQueryParam = (q) => {
    const url = new URL(window.location.href);
    if (q && q.trim()) url.searchParams.set('q', q.trim());
    else url.searchParams.delete('q');
    history.replaceState(null, '', url.toString());
};

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

    // Автоматическая подсветка и скролл к тексту из URL (?highlight=...)
    const highlightText = new URLSearchParams(window.location.search).get('highlight');
    if (highlightText) {
        const clean = (t) => t.replace(/<\/?[^>]+(>|$)/g, '').replace(/^\s*(\d+[\.\)]|[•\-\*\◦\▪])\s+/g, '').replace(/\s+/g, ' ').trim();
        const target = clean(highlightText);
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
            setTimeout(() => {
                bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
                requestAnimationFrame(() => {
                    bestMatch.style.transition = 'background-color 0.6s ease, color 0.6s ease';
                    bestMatch.style.backgroundColor = '#78909c';
                    bestMatch.style.color = '#fff';
                    bestMatch.style.borderRadius = '4px';
                    setTimeout(() => {
                        bestMatch.style.backgroundColor = '';
                        bestMatch.style.color = '';
                    }, 2500);
                });
            }, 600);
        }
    }

    // --- ЛОКАЛЬНЫЙ ПОИСК ДЛЯ СТАТЕЙ ---
    const isHomePage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
    
    if (!isHomePage) {
        const mainContent = document.querySelector('main');
        if (mainContent) {
            // 1. Создаем контейнер поиска (копия структуры с главной)
            const searchSection = document.createElement('section');
            searchSection.className = 'hero';
            searchSection.style.padding = '30px 20px'; // Чуть компактнее для статей
            searchSection.innerHTML = `
                <h2 style="margin-bottom: 15px;">Поиск по текущей статье</h2>
                <div class="search-box" role="search">
                    <input type="text" class="search-input" id="searchInput" placeholder="Введите вопрос по тексту статьи...">
                    <button class="search-btn" id="localSearchBtn">Найти</button>
                </div>
                <div id="short-answer-container" style="display: none; max-width: 600px; margin: 20px auto 0; background: #fff; padding: 15px; border-radius: 8px; box-shadow: var(--shadow); text-align: left; border-left: 4px solid var(--accent-color);"></div>
                <div id="localResults" style="margin-top: 20px; max-width: 800px; margin-left: auto; margin-right: auto;">
                    <div class="results-header" style="display:none;"><h3 id="resultsTitle"></h3><span id="count" style="display:none;"></span></div>
                    <div id="resourcesGrid"></div>
                </div>
            `;
            mainContent.insertBefore(searchSection, mainContent.firstChild);

            // 2. Загружаем зависимости (БД, Данные и поисковый движок)
            // Добавьте '/resources.js' в массив scripts
            const scripts = ['/resources.js', '/semantic-db.js', '/semantic-search.js'];
            scripts.forEach(src => {
                if (!document.querySelector(`script[src="${src}"]`)) {
                    const s = document.createElement('script');
                    s.src = src;
                    // Если это ресурсы, загружаем синхронно перед поиском, если поиск - как модуль
                    if (src.includes('search')) s.type = 'module';
                    document.head.appendChild(s);
                }
            });

            // 3. Привязываем поиск к текущей статье
            const performLocalSearch = () => {
                // Создаем временную функцию рендеринга для локального поиска, если её нет
                window.renderResources = (data) => {
                    const grid = document.getElementById('resourcesGrid');
                    if (grid) grid.innerHTML = ''; // Очистка, так как поиск сам наполнит grid
                };

                if (typeof window.performSearch === 'function') {
                    // Находим ID текущей статьи в массиве resources по URL
                    const currentFile = window.location.pathname.split('/').pop();
                    const article = window.resources?.find(r => r.file === currentFile);
                    window.performSearch(article ? article.id : null);
                    document.querySelector('.results-header').style.display = 'flex';
                }
            };

            document.getElementById('localSearchBtn').addEventListener('click', performLocalSearch);
            document.getElementById('searchInput').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') performLocalSearch();
            });

            // 4. Добавляем элемент статуса, если его нет
            if (!document.getElementById('semantic-status')) {
                const status = document.createElement('div');
                status.id = 'semantic-status';
                status.style.cssText = 'display: none; position: fixed; bottom: 20px; right: 20px; background: var(--primary-color); color: white; padding: 12px 24px; border-radius: 8px; z-index: 9999;';
                document.body.appendChild(status);
            }
        }
    }
});