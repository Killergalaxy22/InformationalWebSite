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
});