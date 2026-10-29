// Apply a saved theme before first paint (phone page). Same key as the main app.
try { var t = localStorage.getItem('learnathanze:theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
