export function el(sel, root = document) {
    return root.querySelector(sel);
}

export function els(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
}

export function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function formatBytes(n) {
    if (n === 0) return "0 B";
    const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(n) / Math.log(k));
    return (n / Math.pow(k, i)).toFixed(i ? 1 : 0) + " " + sizes[i];
}

export function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function timeAgo(t) {
    const d = Math.floor((Date.now() / 1000 - t) / 60);
    if (d <= 0) return "now";
    if (d < 60) return d + "m ago";
    const h = Math.floor(d / 60);
    if (h < 24) return h + "h ago";
    const days = Math.floor(h / 24);
    return days + "d ago";
}

export function stripTags(html) {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, '');
}

export function collapseWs(s) {
    if (!s) return "";
    return s.replace(/\s+/g, ' ').trim();
}

export function parseDateString(dateStr, format) {
    if (!dateStr) return null;
    // Simple date parsing
    const cleanStr = dateStr.replace(/[^\d\/\-]/g, '');
    
    if (format === "%Y-%m-%d" || format === "%Y/%m/%d") {
        const parts = cleanStr.split(/[-\/]/);
        if (parts.length === 3) {
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }
    } else if (format === "%d/%m/%Y" || format === "%d-%m-%Y") {
        const parts = cleanStr.split(/[-\/]/);
        if (parts.length === 3) {
            return new Date(parts[2], parts[1] - 1, parts[0]);
        }
    } else if (format === "%m/%d/%Y" || format === "%m-%d-%Y") {
        const parts = cleanStr.split(/[-\/]/);
        if (parts.length === 3) {
            return new Date(parts[2], parts[0] - 1, parts[1]);
        }
    }
    
    return null;
}

export function formatDateString(dateStr, dateFormat) {
    if (!dateStr || !dateStr.trim()) return dateStr;
    
    // Try to parse common date formats
    const dateFormats = [
        "%Y-%m-%d",
        "%d/%m/%Y", 
        "%m/%d/%Y",
        "%d-%m-%Y",
        "%m-%d-%Y",
        "%Y/%m/%d"
    ];
    
    for (const fmt of dateFormats) {
        try {
            const parsed = parseDateString(dateStr, fmt);
            if (parsed && !isNaN(parsed.getTime())) {
                // Format it back according to dateFormat (simple implementation)
                const d = parsed.getDate().toString().padStart(2, '0');
                const m = (parsed.getMonth() + 1).toString().padStart(2, '0');
                const y = parsed.getFullYear();
                
                return dateFormat
                    .replace('%d', d)
                    .replace('%m', m)
                    .replace('%Y', y);
            }
        } catch (e) {
            continue;
        }
    }
    
    return dateStr;
}

export function toast(msg, kind = "") {
    const t = el("#toast");
    if (!t) return;
    t.textContent = msg;
    t.style.borderColor = kind === "bad" ? "var(--bad)" : (kind === "good" ? "var(--good)" : "var(--border)");
    t.style.display = "block";
    setTimeout(() => t.style.display = "none", 2500);
}

export function setFavicon(status) {
    const link = document.getElementById('favicon');
    if (!link) return;
    if (status === 'running') {
        link.href = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23f08c00%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><circle cx=%2212%22 cy=%2212%22 r=%2210%22></circle><polyline points=%2212 6 12 12 16 14%22></polyline></svg>";
    } else {
        link.href = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z%22></path><polyline points=%2214 2 14 8 20 8%22></polyline><line x1=%2216%22 y1=%2213%22 x2=%228%22 y2=%2213%22></line><line x1=%2216%22 y1=%2217%22 x2=%228%22 y2=%2217%22></line><polyline points=%2210 9 9 9 8 9%22></polyline></svg>";
    }
}