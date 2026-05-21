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
});