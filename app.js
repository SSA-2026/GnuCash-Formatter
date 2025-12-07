// Invoice Formatter
// Runs entirely in the browser using File API and local storage

// Global state
let STATE = {
    projectFolder: null,
    projectDirectoryHandle: null,
    outputDirectoryHandle: null,
    config: null,
    ibanConfig: null,
    inputFiles: [],
    outputFiles: [],
    selectedInputs: new Set(),
    selectedOutputs: new Set(),
    conversion: {
        isRunning: false,
        abortController: null,
    }
};

// IndexedDB for handle storage
const DB_NAME = 'InvoiceFormatterDB';
const STORE_NAME = 'handles';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME);
        };
    });
}

async function storeDirectoryHandle(handle) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(handle, 'projectDirectory');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) { console.error("DB Error:", e); }
}

async function getStoredDirectoryHandle() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get('projectDirectory');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) { return null; }
}

async function clearStoredDirectoryHandle() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete('projectDirectory');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) { console.error("DB Error:", e); }
}

function setFavicon(status) {
    const link = document.getElementById('favicon');
    if (!link) return;
    if (status === 'running') {
        link.href = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23f08c00%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><circle cx=%2212%22 cy=%2212%22 r=%2210%22></circle><polyline points=%2212 6 12 12 16 14%22></polyline></svg>";
    } else {
        link.href = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z%22></path><polyline points=%2214 2 14 8 20 8%22></polyline><line x1=%2216%22 y1=%2213%22 x2=%228%22 y2=%2213%22></line><line x1=%2216%22 y1=%2217%22 x2=%228%22 y2=%2217%22></line><polyline points=%2210 9 9 9 8 9%22></polyline></svg>";
    }
}

// Default configuration (no personal information)
const DEFAULT_CONFIG = {
    bank: {
        account_name: "",
        bic: "",
        btw_number: ""
    },
    banner_path: "",
    column_settings: {
        show_action: false,
        show_date: true,
        show_description: true,
        show_discount: false,
        show_price: true,
        show_quantity: true,
        show_tax_amount: false,
        show_taxable: false,
        show_total: true
    },
    date_settings: {
        date_format: "%d/%m/%Y",
        due_date_format: "%d/%m/%Y",
        show_date: false,
        show_due_date: true
    },
    hide_empty_fields: false,
    payment_request: "We kindly request you to transfer the above-mentioned amount before the due date to the bank account mentioned above, quoting the invoice number.",
    summary_settings: {
        show_amount_due: true,
        show_net_price: false,
        show_tax: true,
        show_total_price: true
    },
    tax_message: "BTW (21%)",
    treasurer: {
        email: "",
        name: "",
        title: "Treasurer"
    }
};

const DEFAULT_IBAN_CONFIG = {
    iban: ""
};

// Utility functions
function toast(msg, kind = "") {
    const t = el("#toast");
    t.textContent = msg;
    t.style.borderColor = kind === "bad" ? "var(--bad)" : (kind === "good" ? "var(--good)" : "var(--border)");
    t.style.display = "block";
    setTimeout(() => t.style.display = "none", 2500);
}

function el(sel, root = document) {
    return root.querySelector(sel);
}

function els(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatBytes(n) {
    if (n === 0) return "0 B";
    const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(n) / Math.log(k));
    return (n / Math.pow(k, i)).toFixed(i ? 1 : 0) + " " + sizes[i];
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function timeAgo(t) {
    const d = Math.floor((Date.now() / 1000 - t) / 60);
    if (d <= 0) return "now";
    if (d < 60) return d + "m ago";
    const h = Math.floor(d / 60);
    if (h < 24) return h + "h ago";
    const days = Math.floor(h / 24);
    return days + "d ago";
}

// Configuration management
function loadConfigFromStorage() {
    try {
        const config = localStorage.getItem('invoice-formatter-config');
        const ibanConfig = localStorage.getItem('invoice-formatter-iban');
        
        STATE.config = config ? JSON.parse(config) : { ...DEFAULT_CONFIG };
        STATE.ibanConfig = ibanConfig ? JSON.parse(ibanConfig) : { ...DEFAULT_IBAN_CONFIG };
        
        updateFolderStatus();
        return true;
    } catch (e) {
        console.error('Failed to load config from storage:', e);
        STATE.config = { ...DEFAULT_CONFIG };
        STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG };
        return false;
    }
}

function saveConfigToStorage() {
    try {
        localStorage.setItem('invoice-formatter-config', JSON.stringify(STATE.config));
        localStorage.setItem('invoice-formatter-iban', JSON.stringify(STATE.ibanConfig));
        updateFolderStatus();
        return true;
    } catch (e) {
        console.error('Failed to save config to storage:', e);
        toast("Failed to save configuration", "bad");
        return false;
    }
}

function updateFolderStatus() {
    const status = el("#folder-status");
    const btnOpen = el("#btn-select-project-folder");
    const btnClose = el("#btn-clear-folder");

    if (STATE.projectFolder) {
        const inputCount = STATE.inputFiles.length;
        const outputCount = STATE.outputFiles.length;
        const hasConfig = STATE.config && STATE.ibanConfig;
        
        let statusText = `${STATE.projectFolder.name} — `;
        statusText += `${inputCount} input, ${outputCount} output`;
        
        if (hasConfig) {
            statusText += " — Config loaded";
            status.style.color = "var(--good)";
        } else {
            statusText += " — No config found";
            status.style.color = "var(--warn)";
        }
        
        status.textContent = statusText;
        
        // Toggle buttons
        btnOpen.classList.add("hidden");
        btnClose.classList.remove("hidden");
    } else {
        status.textContent = "No folder selected";
        status.style.color = "var(--muted)";
        
        // Toggle buttons
        btnOpen.classList.remove("hidden");
        btnClose.classList.add("hidden");
    }
}

// File handling
function downloadFile(content, filename, mimeType = 'text/yaml') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Output folder handling
async function saveToOutputFolder(content, filename) {
    // Try to save to the project's output directory using File System Access API
    if (STATE.outputDirectoryHandle) {
        try {
            const fileHandle = await STATE.outputDirectoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            console.log(`Saved ${filename} to output folder (${formatBytes(new Blob([content]).size)})`);
            
            // Add to output files list for display
            const fileObj = {
                id: Date.now() + Math.random() + '_' + filename,
                name: filename,
                size: new Blob([content]).size,
                content: content,
                type: 'html',
                savedToFile: true
            };
            
            STATE.outputFiles.push(fileObj);
            return fileObj;
        } catch (error) {
            console.error('Failed to save to output folder:', error);
            toast(`Failed to save ${filename} to output folder: ${error.message}`, "bad");
        }
    }
    
    // Fallback: store in memory if no output directory is available
    const fileObj = {
        id: Date.now() + Math.random() + '_' + filename,
        name: filename,
        size: new Blob([content]).size,
        content: content,
        type: 'html',
        savedToFile: false
    };
    
    STATE.outputFiles.push(fileObj);
    console.log(`Stored ${filename} in output list (${formatBytes(fileObj.size)})`);
    return fileObj;
}

// PDF saving to output folder
async function savePdfToOutputFolder(pdfBlob, filename) {
    // Try to save to the project's output directory using File System Access API
    if (STATE.outputDirectoryHandle) {
        try {
            const fileHandle = await STATE.outputDirectoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(pdfBlob);
            await writable.close();
            console.log(`Saved ${filename} to output folder (${formatBytes(pdfBlob.size)})`);
            return true;
        } catch (error) {
            console.error('Failed to save PDF to output folder:', error);
            toast(`Failed to save ${filename} to output folder: ${error.message}`, "bad");
        }
    }
    return false;
}

// Delete HTML files from output directory
async function deleteHtmlFilesFromOutput() {
    // Always remove HTML files from the output files list (UI)
    const initialCount = STATE.outputFiles.length;
    STATE.outputFiles = STATE.outputFiles.filter(f => !f.name.endsWith('.html'));
    const removedFromList = initialCount - STATE.outputFiles.length;
    
    // If we have a directory handle, delete files from disk
    if (STATE.outputDirectoryHandle) {
        try {
            const htmlFilesToDelete = [];
            
            // Find all HTML files in the output directory
            for await (const [name, handle] of STATE.outputDirectoryHandle.entries()) {
                if (name.endsWith('.html')) {
                    htmlFilesToDelete.push(name);
                }
            }
            
            // Delete each HTML file
            for (const filename of htmlFilesToDelete) {
                try {
                    await STATE.outputDirectoryHandle.removeEntry(filename);
                    console.log(`Deleted HTML file from output: ${filename}`);
                } catch (e) {
                    console.warn(`Could not delete ${filename}:`, e);
                }
            }
            
            if (htmlFilesToDelete.length > 0) {
                toast(`Cleaned up ${htmlFilesToDelete.length} HTML file(s) from output`, "good");
            }
        } catch (error) {
            console.error('Failed to delete HTML files from output:', error);
            throw error;
        }
    } else if (removedFromList > 0) {
        console.log(`Removed ${removedFromList} HTML file(s) from output list`);
    }
}

// PDF generation from HTML using jsPDF and html2canvas
async function generatePdfFromHtml(htmlContent, filename) {
    return new Promise(async (resolve, reject) => {
        try {
            // Wait for libraries to load with multiple retries
            let attempts = 0;
            const maxAttempts = 20;
            
            while (attempts < maxAttempts) {
                const jsPdfAvailable = typeof window.jsPDF !== 'undefined' || (typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined');
                const html2CanvasAvailable = typeof window.html2canvas !== 'undefined';
                
                if (jsPdfAvailable && html2CanvasAvailable) {
                    break;
                }
                
                attempts++;
                if (attempts % 5 === 0) console.log(`Waiting for PDF libraries... attempt ${attempts}/${maxAttempts}`);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            // Resolve jsPDF constructor
            let jsPDFConstructor = null;
            if (typeof window.jsPDF !== 'undefined') {
                jsPDFConstructor = window.jsPDF;
            } else if (typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined') {
                jsPDFConstructor = window.jspdf.jsPDF;
            }
            
            const html2CanvasAvailable = typeof window.html2canvas !== 'undefined';
            
            if (!jsPDFConstructor || !html2CanvasAvailable) {
                console.error('PDF Libraries missing. window.jspdf:', window.jspdf, 'window.jsPDF:', window.jsPDF);
                throw new Error(`PDF libraries not available. jsPDF: ${!!jsPDFConstructor}, html2canvas: ${html2CanvasAvailable}. Please refresh the page.`);
            }

            // Create an iframe to render the content in isolation
            // This avoids style contamination and handles full HTML documents correctly
            const iframe = document.createElement('iframe');
            iframe.style.position = 'absolute';
            iframe.style.left = '-9999px';
            iframe.style.width = '1006px';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);

            const doc = iframe.contentDocument || iframe.contentWindow.document;
            
            // Sanitize HTML content to remove unsupported color functions
            // Also replace any other modern color functions that might cause issues
            let sanitizedHtml = htmlContent
                .replace(/oklch\([^)]+\)/gi, '#000000')
                .replace(/oklab\([^)]+\)/gi, '#000000')
                .replace(/lch\([^)]+\)/gi, '#000000')
                .replace(/lab\([^)]+\)/gi, '#000000');
            
            doc.open();
            doc.write(sanitizedHtml);
            
            // Inject style to force light scheme and override potential oklch sources
            const style = doc.createElement('style');
            style.textContent = `
                :root { color-scheme: light; }
                * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            `;
            if (doc.head) {
                doc.head.appendChild(style);
            } else {
                doc.body.appendChild(style);
            }
            
            doc.close();

            // Wait for images to load
            const images = doc.querySelectorAll('img');
            const imagePromises = Array.from(images).map(img => {
                return new Promise((resolve) => {
                    if (img.complete) {
                        resolve();
                    } else {
                        img.onload = resolve;
                        img.onerror = resolve;
                        setTimeout(resolve, 3000);
                    }
                });
            });

            await Promise.all(imagePromises);
            await new Promise(resolve => setTimeout(resolve, 500)); // Extra wait for rendering

            try {
                // Use html2canvas to capture the iframe body
                const canvas = await html2canvas(doc.body, {
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    width: 1006,
                    windowWidth: 1006,
                    height: doc.body.scrollHeight, // Use body height
                    logging: false,
                    window: iframe.contentWindow, // Use iframe window context
                    onclone: (clonedDoc) => {
                        const style = clonedDoc.createElement('style');
                        style.textContent = `
                            @page { margin: 0; }
                            html, body { margin: 0 !important; }
                            table { border-collapse: collapse !important; border-spacing: 0 !important; }
                        `;
                        clonedDoc.head.appendChild(style);
                    }
                });

                // Remove the iframe
                document.body.removeChild(iframe);

                // Create PDF using the resolved constructor
                const pdf = new jsPDFConstructor({
                    orientation: 'portrait',
                    unit: 'mm',
                    format: 'a4'
                });

                // Calculate dimensions to fit the content properly
                const imgWidth = 210; // A4 width in mm
                const pageHeight = 297; // A4 height in mm
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                let heightLeft = imgHeight;
                let position = 0;

                // Add the image to PDF with no margins to match Playwright
                pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;

                // Add new pages if content is longer than one page
                while (heightLeft >= 0) {
                    position = heightLeft - imgHeight;
                    pdf.addPage();
                    pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', 0, position, imgWidth, imgHeight);
                    heightLeft -= pageHeight;
                }

                // Generate PDF blob
                const pdfBlob = pdf.output('blob');
                resolve(pdfBlob);

            } catch (canvasError) {
                // Clean up iframe if canvas generation fails
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
                throw canvasError;
            }

        } catch (error) {
            console.error('PDF generation failed:', error);
            reject(error);
        }
    });
}

// IBAN Modal functions
function showIbanModal() {
    el("#iban-modal").classList.remove("hidden");
    el("#iban-input").value = STATE.ibanConfig?.iban || "";
    el("#iban-input").focus();
}

function hideIbanModal() {
    el("#iban-modal").classList.add("hidden");
}

function saveIbanFromModal() {
    const ibanValue = el("#iban-input").value.trim();
    
    if (!ibanValue) {
        toast("Please enter an IBAN", "warn");
        return;
    }
    
    STATE.ibanConfig = STATE.ibanConfig || {};
    STATE.ibanConfig.iban = ibanValue;
    
    saveConfigToStorage();
    saveIbanToFile();
    hideIbanModal();
    toast("IBAN saved successfully", "good");
    
    // Retry the conversion
    setTimeout(() => {
        convertFiles(false);
    }, 500);
}

// Save IBAN to iban.yml file
async function saveIbanToFile() {
    if (!STATE.projectDirectoryHandle) {
        console.log('No project directory handle, skipping IBAN file save');
        return;
    }
    
    try {
        // Get the config directory handle
        const configHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('config');
        
        // Create or get the iban.yml file
        const fileHandle = await configHandle.getFileHandle('iban.yml', { create: true });
        const writable = await fileHandle.createWritable();
        
        // Generate YAML content
        const yamlContent = `iban: "${STATE.ibanConfig.iban}"\n`;
        
        // Write to file
        await writable.write(yamlContent);
        await writable.close();
        
        console.log('IBAN saved to iban.yml file');
    } catch (error) {
        console.error('Failed to save IBAN to file:', error);
        // Don't show error to user as localStorage save was successful
    }
}

// File System Access API functions
async function ensureDirectoryStructure(directoryHandle) {
    try {
        // Create input, output, and config subdirectories if they don't exist
        await directoryHandle.getDirectoryHandle('input', { create: true });
        await directoryHandle.getDirectoryHandle('output', { create: true });
        await directoryHandle.getDirectoryHandle('config', { create: true });
        console.log('Directory structure ensured: input/, output/, config/');
        return true;
    } catch (error) {
        console.error('Failed to create directory structure:', error);
        toast("Failed to create directory structure: " + error.message, "bad");
        return false;
    }
}

async function selectProjectFolderWithFileSystem() {
    try {
        if ('showDirectoryPicker' in window) {
            const directoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            
            // Ensure the required directory structure exists
            const structureCreated = await ensureDirectoryStructure(directoryHandle);
            if (!structureCreated) {
                return;
            }
            
            // Get handles to the subdirectories
            const inputHandle = await directoryHandle.getDirectoryHandle('input');
            const outputHandle = await directoryHandle.getDirectoryHandle('output');
            const configHandle = await directoryHandle.getDirectoryHandle('config');
            
            // Store the directory handles
            STATE.projectDirectoryHandle = directoryHandle;
            STATE.outputDirectoryHandle = outputHandle;
            
            // Save handle to DB
            await storeDirectoryHandle(directoryHandle);

            // Load files from the subdirectories
            await loadFilesFromDirectoryStructure(inputHandle, outputHandle, configHandle);
            
            updateFolderStatus();
            toast("Project folder selected and structure created", "good");
        } else {
            toast("File System Access API not supported in this browser", "bad");
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Failed to select project folder:', error);
            toast("Failed to select project folder: " + error.message, "bad");
        }
    }
}

async function loadFilesFromDirectoryStructure(inputHandle, outputHandle, configHandle) {
    try {
        // Reset state
        STATE.projectFolder = { name: STATE.projectDirectoryHandle.name, files: [] };
        STATE.inputFiles = [];
        STATE.outputFiles = [];
        STATE.selectedInputs.clear();
        STATE.selectedOutputs.clear();
        
        // Load config files
        const configFiles = {};
        try {
            const configYmlHandle = await configHandle.getFileHandle('config.yml');
            const configYmlFile = await configYmlHandle.getFile();
            const configYmlText = await configYmlFile.text();
            configFiles.config = parseSimpleYaml(configYmlText);
            console.log('Loaded config.yml');
        } catch (e) {
            console.log('config.yml not found, will use defaults');
        }
        
        try {
            const ibanYmlHandle = await configHandle.getFileHandle('iban.yml');
            const ibanYmlFile = await ibanYmlHandle.getFile();
            const ibanYmlText = await ibanYmlFile.text();
            configFiles.iban = parseSimpleYaml(ibanYmlText);
            console.log('Loaded iban.yml');
        } catch (e) {
            console.log('iban.yml not found, will use defaults');
        }
        
        // Load input files
        const inputFiles = [];
        for await (const [name, handle] of inputHandle.entries()) {
            if (name.endsWith('.html')) {
                const file = await handle.getFile();
                const fileObj = {
                    id: Date.now() + Math.random() + '_' + name,
                    file: file,
                    name: name,
                    size: file.size,
                    lastModified: file.lastModified
                };
                inputFiles.push(fileObj);
                console.log('Added input file:', name);
            }
        }
        
        // Load output files
        const outputFiles = [];
        for await (const [name, handle] of outputHandle.entries()) {
            if (name.endsWith('.html') || name.endsWith('.pdf')) {
                const file = await handle.getFile();
                const fileObj = {
                    id: Date.now() + Math.random() + '_' + name,
                    file: file,
                    name: name,
                    size: file.size,
                    lastModified: file.lastModified,
                    type: name.endsWith('.pdf') ? 'pdf' : 'html'
                };
                outputFiles.push(fileObj);
                console.log('Added output file:', name);
            }
        }
        
        // Update configuration
        if (configFiles.config) {
            STATE.config = { ...DEFAULT_CONFIG, ...configFiles.config };
            console.log('Loaded config:', STATE.config);
        } else {
            STATE.config = { ...DEFAULT_CONFIG };
            console.log('Using default config');
        }
        
        if (configFiles.iban) {
            STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG, ...configFiles.iban };
            console.log('Loaded IBAN config:', STATE.ibanConfig);
        } else {
            STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG };
            console.log('Using default IBAN config');
        }
        
        // Update files
        STATE.inputFiles = inputFiles;
        STATE.outputFiles = outputFiles;
        
        // Save to localStorage
        saveConfigToStorage();
        
        // Update UI
        renderInputs();
        renderOutputs();
        
        const configCount = Object.keys(configFiles).length;
        toast(`Loaded project: ${inputFiles.length} input files, ${outputFiles.length} output files, ${configCount} config files`, "good");
        
    } catch (error) {
        console.error('Failed to load files from directory structure:', error);
        toast("Failed to load project files: " + error.message, "bad");
    }
}

// Folder handling
async function handleProjectFolder(files) {
    try {
        console.log('Processing project folder with', files.length, 'files');
        
        // Reset state
        STATE.projectFolder = { name: 'Selected Folder', files: [] };
        STATE.inputFiles = [];
        STATE.outputFiles = [];
        STATE.selectedInputs.clear();
        STATE.selectedOutputs.clear();
        
        // Process files
        const configFiles = {};
        const inputFiles = [];
        const outputFiles = [];
        let processedFiles = 0;
        
        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            console.log('Processing file:', path);
            
            const parts = path.split('/');
            console.log('Path parts:', parts);
            
            if (parts.length >= 3) {
                // Handle structure like: formatter/input/file.html
                const rootFolder = parts[0]; // formatter
                const folder = parts[1];     // input, output, config
                const filename = parts.slice(2).join('/');
                
                console.log(`Root: ${rootFolder}, Folder: ${folder}, Filename: ${filename}`);
                
                if (folder === 'config') {
                    if (filename === 'config.yml' || filename === 'config.yaml') {
                        console.log('Loading config.yml');
                        const text = await file.text();
                        configFiles.config = parseSimpleYaml(text);
                        processedFiles++;
                    } else if (filename === 'iban.yml' || filename === 'iban.yaml') {
                        console.log('Loading iban.yml');
                        const text = await file.text();
                        configFiles.iban = parseSimpleYaml(text);
                        processedFiles++;
                    }
                } else if (folder === 'input') {
                    if (filename.endsWith('.html')) {
                        console.log('Adding HTML file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified
                        };
                        inputFiles.push(fileObj);
                        processedFiles++;
                    }
                } else if (folder === 'output') {
                    // Load existing output files for display
                    if (filename.endsWith('.html') || filename.endsWith('.pdf')) {
                        console.log('Adding output file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified,
                            type: filename.endsWith('.pdf') ? 'pdf' : 'html'
                        };
                        outputFiles.push(fileObj);
                        processedFiles++;
                    }
                }
            } else if (parts.length >= 2) {
                // Handle direct structure like: input/file.html (for backward compatibility)
                const folder = parts[0];
                const filename = parts.slice(1).join('/');
                
                console.log(`Direct structure - Folder: ${folder}, Filename: ${filename}`);
                
                if (folder === 'config') {
                    if (filename === 'config.yml' || filename === 'config.yaml') {
                        console.log('Loading config.yml');
                        const text = await file.text();
                        configFiles.config = parseSimpleYaml(text);
                        processedFiles++;
                    } else if (filename === 'iban.yml' || filename === 'iban.yaml') {
                        console.log('Loading iban.yml');
                        const text = await file.text();
                        configFiles.iban = parseSimpleYaml(text);
                        processedFiles++;
                    }
                } else if (folder === 'input') {
                    if (filename.endsWith('.html')) {
                        console.log('Adding HTML file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified
                        };
                        inputFiles.push(fileObj);
                        processedFiles++;
                    }
                } else if (folder === 'output') {
                    // Load existing output files for display
                    if (filename.endsWith('.html') || filename.endsWith('.pdf')) {
                        console.log('Adding output file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified,
                            type: filename.endsWith('.pdf') ? 'pdf' : 'html'
                        };
                        outputFiles.push(fileObj);
                        processedFiles++;
                    }
                }
            } else {
                console.log('Skipping file (not in expected folder structure):', path);
            }
        }
        
        console.log('Processed files:', processedFiles);
        console.log('Config files found:', Object.keys(configFiles));
        console.log('Input files found:', inputFiles.length);
        
        // Update configuration
        if (configFiles.config) {
            STATE.config = { ...DEFAULT_CONFIG, ...configFiles.config };
            console.log('Loaded config:', STATE.config);
        } else {
            STATE.config = { ...DEFAULT_CONFIG };
            console.log('Using default config');
        }
        
        if (configFiles.iban) {
            STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG, ...configFiles.iban };
            console.log('Loaded IBAN config:', STATE.ibanConfig);
        } else {
            STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG };
            console.log('Using default IBAN config');
        }
        
        // Update files
        STATE.inputFiles = inputFiles;
        STATE.outputFiles = outputFiles;
        
        // Save to localStorage
        saveConfigToStorage();
        
        // Update UI
        renderInputs();
        renderOutputs();
        updateFolderStatus();
        
        const configCount = Object.keys(configFiles).length;
        toast(`Loaded folder: ${inputFiles.length} input files, ${outputFiles.length} output files, ${configCount} config files`, "good");
        
    } catch (e) {
        console.error('Failed to handle project folder:', e);
        toast("Failed to load project folder: " + e.message, "bad");
    }
}

async function clearProjectFolder() {
    STATE.projectFolder = null;
    STATE.inputFiles = [];
    STATE.outputFiles = [];
    STATE.selectedInputs.clear();
    STATE.selectedOutputs.clear();
    
    await clearStoredDirectoryHandle();

    renderInputs();
    renderOutputs();
    updateFolderStatus();
    
    toast("Project folder cleared", "good");
}

function parseSimpleYaml(text) {
    const result = {};
    const lines = text.split('\n');
    const stack = [{ obj: result, indent: -1 }];
    
    for (let i = 0; i < lines.length; i++) {
        const originalLine = lines[i];
        const line = originalLine.trim();
        
        // Skip empty lines and comments
        if (!line || line.startsWith('#')) continue;
        
        const indent = originalLine.search(/\S/);
        const colonIndex = line.indexOf(':');
        
        if (colonIndex === -1) continue; // Skip lines without colons
        
        const key = line.substring(0, colonIndex).trim();
        const valuePart = line.substring(colonIndex + 1).trim();
        
        // Find the right parent level based on indentation
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        
        const current = stack[stack.length - 1].obj;
        
        if (valuePart) {
            // Handle different value types
            if (valuePart === 'null' || valuePart === '~') {
                current[key] = null;
            } else if (valuePart === 'true' || valuePart === 'false') {
                current[key] = valuePart === 'true';
            } else if (valuePart.match(/^[-+]?\d+$/)) {
                current[key] = parseInt(valuePart, 10);
            } else if (valuePart.match(/^[-+]?\d*\.\d+$/)) {
                current[key] = parseFloat(valuePart);
            } else if (valuePart.startsWith('"') || valuePart.startsWith("'")) {
                // Quoted string
                current[key] = valuePart.slice(1, -1);
            } else if (valuePart === '|') {
                // Multiline string
                let multilineValue = [];
                let baseIndent = -1;
                
                // Look ahead for indented lines
                while (i + 1 < lines.length) {
                    const nextLineOriginal = lines[i + 1];
                    const nextLineTrimmed = nextLineOriginal.trim();
                    
                    if (!nextLineTrimmed) {
                        i++; // Skip empty lines but keep going
                        continue;
                    }
                    
                    const nextIndent = nextLineOriginal.search(/\S/);
                    
                    if (baseIndent === -1) baseIndent = nextIndent;
                    
                    if (nextIndent > indent) {
                        multilineValue.push(nextLineTrimmed);
                        i++;
                    } else {
                        break; // End of indented block
                    }
                }
                current[key] = multilineValue.join('\n');
            } else {
                // Unquoted string
                current[key] = valuePart.replace(/^["']|["']$/g, '');
            }
        } else {
            // Object (nested structure)
            current[key] = {};
            stack.push({ obj: current[key], indent: indent });
        }
    }
    
    return result;
}

// Invoice parsing and conversion
function parseEasyInvoice(html) {
    const data = {};
    
    // Extract invoice number
    const invoiceMatch = html.match(/Invoice\s*#([A-Za-z0-9_.\-]+)/);
    data.invoice_number = invoiceMatch ? invoiceMatch[1] : '';
    
    // Extract dates
    data.date = extractLabelValue(html, "Date");
    data.due_date = extractLabelValue(html, "Due Date");
    
    // Extract client and company info
    data.client_name_html = extractDivClass(html, "client-name");
    data.client_address_html = extractDivClass(html, "client-address");
    data.company_name_html = extractDivClass(html, "company-name");
    data.company_address_html = extractDivClass(html, "company-address");
    
    // Extract entries table
    const entriesHtml = extractEntriesTable(html);
    const { items, summary } = parseEntriesTable(entriesHtml);
    
    data.items = items;
    data.summary = summary;
    
    return data;
}

function extractLabelValue(html, label) {
    const pattern = new RegExp(`<td>\\s*${label}\\s*:\\s*</td>\\s*<td>\\s*<div[^>]*>(.*?)</div>`, 'i');
    const match = html.match(pattern);
    if (match) {
        return collapseWs(stripTags(match[1]));
    }
    return '';
}

function extractDivClass(html, className) {
    const pattern = new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>(.*?)</div>`, 'i');
    const match = html.match(pattern);
    return match ? match[1].trim() : '';
}

function extractEntriesTable(html) {
    const match = html.match(/<div class="entries-table">(.*?)<\/div>\s*<\/td>/is);
    return match ? match[1] : '';
}

function parseEntriesTable(html) {
    const items = [];
    const summary = { net: '', tax: '', total: '', due: '' };
    
    const trMatches = html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis);
    
    for (const trMatch of trMatches) {
        const trHtml = trMatch[1];
        const tdMatches = trHtml.matchAll(/<td[^>]*>(.*?)<\/td>/gis);
        const cells = Array.from(tdMatches, m => m[1]);
        
        if (cells.length === 0) continue;
        
        const firstCellText = collapseWs(stripTags(cells[0])).toLowerCase();
        
        // Check if this is a summary row
        const labelMap = {
            "net price": "net",
            "tax": "tax",
            "total price": "total",
            "amount due": "due",
        };
        
        if (labelMap[firstCellText]) {
            const currencyMatch = trHtml.match(/[€\u20AC]\s?[\d.,]+/);
            if (currencyMatch) {
                summary[labelMap[firstCellText]] = currencyMatch[0];
            }
            continue;
        }
        
        // Parse item row
        const item = {};
        const columnOrder = ["date", "description", "action", "quantity", "unit_price", "discount", "taxable", "total"];
        
        cells.forEach((cell, index) => {
            if (index < columnOrder.length) {
                item[columnOrder[index]] = collapseWs(stripTags(cell));
            }
        });
        
        if (item.date || item.description) {
            items.push(item);
        }
    }
    
    return { items, summary };
}

function stripTags(html) {
    return html.replace(/<[^>]+>/g, '');
}

function collapseWs(s) {
    return s.replace(/\s+/g, ' ').trim();
}

function formatDateString(dateStr, dateFormat) {
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
            if (parsed) {
                return formatDateString(parsed, dateFormat);
            }
        } catch (e) {
            continue;
        }
    }
    
    return dateStr;
}

function parseDateString(dateStr, format) {
    // Simple date parsing - this is a basic implementation
    // In a real implementation, you'd want a more robust date parser
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

function buildImprovedHtml(data, config, ibanConfig, bannerDataUrl) {
    const c = config || {};
    const iban = ibanConfig || {};
    
    let bannerHtml = "";
    
    if (bannerDataUrl) {
        // Use the pre-loaded data URL
        bannerHtml = `<tr><td align="left"><img src="${bannerDataUrl}" alt="Invoice Banner" style="width: 100%;" /></td></tr>`;
    } else if (c.banner_path) {
        // Fallback for when not using File System API or if loading failed
        if (c.banner_path.startsWith('http') || c.banner_path.startsWith('data:')) {
            bannerHtml = `<tr><td align="left"><img src="${escapeHtml(c.banner_path)}" alt="Invoice Banner" style="width: 100%;" onerror="this.style.display='none'; this.alt='Banner not found: ${escapeHtml(c.banner_path)}';" /></td></tr>`;
        } else {
            // Try relative path (might fail if not served correctly)
            const bannerPath = c.banner_path.startsWith('./') ? c.banner_path.substring(2) : c.banner_path;
            bannerHtml = `<tr><td align="left"><img src="config/${bannerPath}" alt="Invoice Banner" style="width: 100%;" onerror="this.style.display='none'; this.alt='Banner not found: config/${bannerPath}';" /></td></tr>`;
        }
    }
    
    // Build headers based on column settings
    const columnSettings = c.column_settings || {};
    const headers = [];
    if (columnSettings.show_date !== false) headers.push("Date");
    if (columnSettings.show_description !== false) headers.push("Description");
    if (columnSettings.show_action) headers.push("Action");
    if (columnSettings.show_quantity) headers.push("Quantity");
    if (columnSettings.show_price) headers.push("Price");
    if (columnSettings.show_discount) headers.push("Discount");
    if (columnSettings.show_taxable) headers.push("Taxable");
    if (columnSettings.show_tax_amount) headers.push("Tax Amount");
    if (columnSettings.show_total !== false) headers.push("Total");
    
    // Build item rows
    const itemRows = [];
    data.items.forEach((item, i) => {
        const bg = i === 0 ? "#92a7b6" : "#ffffff";
        const cells = [];
        
        function getCell(key, defaultVal = "") {
            const value = item[key] || defaultVal;
            if (c.hide_empty_fields && !value.trim()) return "";
            return escapeHtml(value);
        }
        
        if (columnSettings.show_date !== false) {
            const dateVal = getCell("date");
            cells.push(`<td>${dateVal}</td>`);
        }
        if (columnSettings.show_description !== false) {
            const descVal = getCell("description");
            cells.push(`<td>${descVal}</td>`);
        }
        if (columnSettings.show_action) {
            cells.push(`<td>${getCell("action")}</td>`);
        }
        if (columnSettings.show_quantity) {
            cells.push(`<td class="number-cell">${getCell("quantity")}</td>`);
        }
        if (columnSettings.show_price) {
            cells.push(`<td class="number-cell">${getCell("unit_price")}</td>`);
        }
        if (columnSettings.show_discount) {
            cells.push(`<td class="number-cell">${getCell("discount")}</td>`);
        }
        if (columnSettings.show_taxable) {
            cells.push(`<td>${getCell("taxable")}</td>`);
        }
        if (columnSettings.show_tax_amount) {
            cells.push(`<td class="number-cell">${getCell("tax_amount")}</td>`);
        }
        if (columnSettings.show_total !== false) {
            cells.push(`<td class="number-cell">${getCell("total")}</td>`);
        }
        
        itemRows.push(`<tr bgcolor="${bg}">${cells.join('')}</tr>`);
    });
    
    // Build summary rows
    const summarySettings = c.summary_settings || {};
    const summary = data.summary || {};
    const taxLabel = c.tax_message || "BTW (21%)";
    
    const summaryRows = [];
    if (summarySettings.show_net_price !== false && summary.net) {
        summaryRows.push(["Net Price", summary.net]);
    }
    if (summarySettings.show_tax !== false && summary.tax) {
        summaryRows.push([taxLabel, summary.tax]);
    }
    if (summarySettings.show_total_price !== false && summary.total) {
        summaryRows.push(["Total Price", summary.total]);
    }
    if (summarySettings.show_amount_due !== false && summary.due) {
        summaryRows.push(["Amount Due", summary.due]);
    }
    
    const summaryColspan = Math.max(1, headers.length - 1);
    const summaryHtml = summaryRows.map(([label, value]) =>
        `<tr bgcolor="#ffffff"><td class="total-label-cell">${escapeHtml(label)}</td>` +
        `<td class="total-number-cell" colspan="${summaryColspan}">${escapeHtml(value)}</td></tr>`
    ).join('');
    
    // Build notes
    const notesLines = [];
    
    if (iban.iban || c.bank?.bic || c.bank?.btw_number) {
        notesLines.push("", "");
        if (iban.iban) notesLines.push(`IBAN: ${iban.iban}`);
        if (c.bank?.bic) notesLines.push(`BIC: ${c.bank.bic}`);
        if (c.bank?.btw_number) notesLines.push(`BTW number: ${c.bank.btw_number}`);
        notesLines.push("", "");
    }
    
    if (c.payment_request) {
        notesLines.push(...c.payment_request.split('\n'));
    } else {
        notesLines.push(
            "We kindly request you to transfer the above-mentioned amount before the due date",
            "to the bank account mentioned above in the name of Stichting Studiereis Astatine in Enschede,",
            "quoting the invoice number."
        );
    }
    
    notesLines.push("", "With kind regards,", "");
    if (c.treasurer?.name) notesLines.push(c.treasurer.name);
    if (c.treasurer?.title) notesLines.push(c.treasurer.title);
    if (c.treasurer?.email) notesLines.push(c.treasurer.email);
    
    const notesHtml = notesLines.map(line => escapeHtml(line)).join('<br />');
    
    // Date settings
    const dateSettings = c.date_settings || {};
    const showDate = dateSettings.show_date !== false && data.date;
    const showDueDate = dateSettings.show_due_date !== false && data.due_date;
    
    // Use the exact same HTML structure as the Python version
    return `<!DOCTYPE html>
<html dir='auto'>
<head>
<meta http-equiv="content-type" content="text/html; charset=utf-8" />
<style type="text/css">
img {
    width: 100%;
    height: auto;
    display: block;
    margin-left: auto;
    margin-right: auto;
}
@media (prefers-color-scheme: dark) {body {color: #000; background-color: #fff;}}
h3 { font-family: "Open Sans", sans-serif; font-size: 18pt; font-weight: bold; }
a { font-family: "Open Sans", sans-serif; font-size: 12pt; font-style: italic; }
body, p, table, tr, td { vertical-align: top; font-family: "Open Sans", sans-serif; font-size: 13pt; }
tr.alternate-row { background: #ffffff }
tr { page-break-inside: avoid !important;}
html, body { height: 100vh; margin: 0 8px; }
td, th { border-color: grey }
th.column-heading-left { text-align: left; font-family: "Open Sans", sans-serif; font-size: 12pt; }
th.column-heading-center { text-align: center; font-family: "Open Sans", sans-serif; font-size: 12pt; }
th.column-heading-right { text-align: right; font-family: "Open Sans", sans-serif; font-size: 12pt; }
td.highlight {background-color:#e1e1e1}
td.neg { color: red; }
td.number-cell, td.total-number-cell { text-align: right; white-space: nowrap; }
td.date-cell { white-space: nowrap; }
td.anchor-cell { white-space: nowrap; font-family: "Open Sans", sans-serif; font-size: 13pt; }
td.number-cell { font-family: "Open Sans", sans-serif; font-size: 14pt; }
td.number-header { text-align: right; font-family: "Open Sans", sans-serif; font-size: 12pt; }
td.text-cell { font-family: "Open Sans", sans-serif; font-size: 13pt; }
td.total-number-cell { font-family: "Open Sans", sans-serif; font-size: 14pt; }
td.total-label-cell { font-family: "Open Sans", sans-serif; font-size: 14pt; }
td.centered-label-cell { text-align: center; font-family: "Open Sans", sans-serif; font-size: 14pt; font-weight: bold; }
sub { top: 0.4em; }
sub, sup { vertical-align: baseline; position: relative; top: -0.4em; }
@media print { html, body { height: unset; }}
.div-align-right { float: right; }
.div-align-right .maybe-align-right { text-align: right }
.entries-table * { border-width: 1px; border-style:solid; border-collapse: collapse}
.entries-table > table { width: 100% }
.company-table > table * { padding: 0px; }
.client-table > table * { padding: 0px; }
.invoice-details-table > table * { padding: 0px; text-indent: 0.2em; }
.main-table > table { width: 80%; }
.company-name, .client-name { font-size: x-large; margin: 0; line-height: 1.25; }
.client-table .client-name { text-align: left; }
.client-table .maybe-align-right { text-align: left; }
.invoice-title { font-weight: bold; }
.invoice-notes { margin-top: 0; width: 100%; }
</style>
</head>
<body text="#000000" link="#1c3661" bgcolor="#ffffff">
<table cellspacing="1" cellpadding="1" border="0" width="100%" style="margin-left:auto; margin-right:auto; max-width: 1006px;">
  <tbody>
    ${bannerHtml}
    <tr><td><h3></h3></td></tr>
    <tr><td>
      <div class="main-table">
        <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
          <tbody>
            <tr><td colspan="2"><div class="invoice-title">Invoice #${escapeHtml(data.invoice_number || "")}</div></td></tr>
            <tr>
              <td> </td>
              <td>
                <div class="div-align-right">
                  <div class="invoice-details-table">
                  <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
                    <tbody>
                      ${showDate ? `<tr><td>Date:</td><td><div class="div-align-right">${escapeHtml(data.date || "")}</div></td></tr>` : ''}
                        ${showDueDate ? `<tr><td>Due Date:</td><td><div class="div-align-right">${escapeHtml(data.due_date || "")}</div></td></tr>` : ''}
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td>
                <div class="client-table">
                  <table cellspacing="1" cellpadding="1" border="0" style="margin-left:0; margin-right:0">
                    <tbody>
                      <tr><td><div class="maybe-align-right client-name">${data.client_name_html || ""}</div></td></tr>
                      <tr><td><div class="maybe-align-right client-address">${data.client_address_html || ""}</div></td></tr>
                    </tbody>
                  </table>
                </div>
              </td>
              <td>
                <div class="div-align-right">
                  <div class="company-table">
                    <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
                      <tbody>
                        <tr><td><div class="maybe-align-right company-name">${data.company_name_html || ""}</div></td></tr>
                        <tr><td><div class="maybe-align-right company-address">${data.company_address_html || ""}</div></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
            <tr><td> </td><td><div class="div-align-right"> </div></td></tr>
            <tr>
              <td colspan="2">
                <div class="entries-table">
                  <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
                    <thead>
                      <tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                      ${itemRows.join('')}
                      ${summaryHtml}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
            <tr>
              <td colspan="2">
                <div class="invoice-notes">${notesHtml}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </td></tr>
  </tbody>
</table>
</body>
</html>`;
}

// UI rendering
function renderInputs() {
    const box = el("#inputs-list");
    const dropZone = el("#drop-zone-inline");
    const countBadge = el("#count-inputs");
    
    // Update count
    if (countBadge) countBadge.textContent = STATE.inputFiles.length;
    
    if (STATE.inputFiles.length === 0) {
        box.classList.add("hidden");
        if (dropZone) dropZone.classList.remove("hidden");
        return;
    }
    
    box.classList.remove("hidden");
    if (dropZone) dropZone.classList.add("hidden");
    
    // Clear existing rows
    els(".rowi", box).forEach(n => n.remove());
    
    STATE.inputFiles.forEach(file => {
        const row = document.createElement("div");
        row.className = "rowi";
        row.innerHTML = `
            <div><input type="checkbox" class="pick" data-id="${file.id}" /></div>
            <div class="mono" title="${file.name}">${file.name}<div class="pill">${formatBytes(file.size)}</div></div>
            <div class="actions">
                <button class="btn ghost icon-only preview" data-id="${file.id}" title="Preview">
                    <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                </button>
                <button class="btn ghost icon-only edit" data-id="${file.id}" title="Edit Data">
                    <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </button>
            </div>
        `;
        box.appendChild(row);
        
        const checkbox = row.querySelector("input.pick");
        checkbox.checked = STATE.selectedInputs.has(file.id);
        checkbox.addEventListener("change", (e) => {
            if (e.target.checked) {
                STATE.selectedInputs.add(file.id);
            } else {
                STATE.selectedInputs.delete(file.id);
            }
            updateSelectAllCheckbox('inputs');
        });
        
        row.querySelector("button.preview").addEventListener("click", () => {
            previewInputFile(file);
        });

        row.querySelector("button.edit").addEventListener("click", () => {
            openEditModal(file);
        });
    });
    
    updateSelectAllCheckbox('inputs');
}

function renderOutputs() {
    const box = el("#outputs-list");
    const countBadge = el("#count-outputs");
    
    // Update count
    if (countBadge) countBadge.textContent = STATE.outputFiles.length;
    
    // Clear existing rows
    els(".rowi", box).forEach(n => n.remove());
    
    if (STATE.outputFiles.length === 0) {
        const emptyRow = document.createElement("div");
        emptyRow.className = "rowi";
        emptyRow.style.justifyContent = "center";
        emptyRow.style.color = "var(--muted)";
        emptyRow.style.padding = "20px";
        emptyRow.style.display = "flex";
        emptyRow.textContent = "No output files yet";
        box.appendChild(emptyRow);
        return;
    }
    
    STATE.outputFiles.forEach(file => {
        const row = document.createElement("div");
        row.className = "rowi";
        row.innerHTML = `
            <div><input type="checkbox" class="pick" data-id="${file.id}" /></div>
            <div class="mono" title="${file.name}">${file.name}<div class="pill">${formatBytes(file.size)}</div></div>
            <div class="actions">
                <button class="btn ghost icon-only preview" data-id="${file.id}" title="Preview">
                    <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                </button>
                <button class="btn ghost icon-only print" data-id="${file.id}" title="Print">
                    <svg viewBox="0 0 24 24"><path d="M19 8h-1V3H6v5H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zM8 5h8v3H8V5zm8 12v2H8v-4h8v2zm2-2v-2H6v2H4v-4c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v4h-2z"/><circle cx="18" cy="11.5" r="1"/></svg>
                </button>
            </div>
        `;
        box.appendChild(row);
        
        const checkbox = row.querySelector("input.pick");
        checkbox.checked = STATE.selectedOutputs.has(file.id);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                STATE.selectedOutputs.add(file.id);
            } else {
                STATE.selectedOutputs.delete(file.id);
            }
            updateSelectAllCheckbox('outputs');
        });
        
        row.querySelector("button.preview").addEventListener("click", () => {
            previewOutputFile(file);
        });
        
        row.querySelector("button.print").addEventListener("click", () => {
            printOutputFile(file);
        });
    });
    
    updateSelectAllCheckbox('outputs');
}

function updateSelectAllCheckbox(listName) {
    const selectAllCheckbox = el(`#select-all-${listName}`);
    const selectedSet = listName === 'inputs' ? STATE.selectedInputs : STATE.selectedOutputs;
    const items = listName === 'inputs' ? STATE.inputFiles : STATE.outputFiles;
    
    if (!selectAllCheckbox || items.length === 0) return;
    
    if (selectedSet.size === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (selectedSet.size === items.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// File operations
function addInputFiles(files) {
    const newFiles = [];
    
    for (const file of files) {
        if (!file.name.endsWith('.html')) continue;
        
        const fileObj = {
            id: Date.now() + Math.random() + '_' + file.name,
            file: file,
            name: file.name,
            size: file.size,
            lastModified: file.lastModified
        };
        
        STATE.inputFiles.push(fileObj);
        newFiles.push(fileObj);
    }
    
    if (newFiles.length > 0) {
        renderInputs();
        toast(`Added ${newFiles.length} file(s)`, "good");
    } else {
        toast("No HTML files found", "warn");
    }
}

async function removeInputFile(fileId) {
    const file = STATE.inputFiles.find(f => f.id === fileId);
    if (!file) return;

    STATE.inputFiles = STATE.inputFiles.filter(f => f.id !== fileId);
    STATE.selectedInputs.delete(fileId);
    renderInputs();

    // Remove from disk if project folder is open
    if (STATE.projectDirectoryHandle) {
        try {
            const inputHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('input');
            await inputHandle.removeEntry(file.name);
            console.log(`Deleted input file from disk: ${file.name}`);
        } catch (e) {
            console.error(`Failed to delete ${file.name} from disk:`, e);
            toast(`Failed to delete file from disk: ${e.message}`, "warn");
        }
    }
}

async function previewInputFile(fileObj) {
    const modal = el("#preview-modal");
    const frame = el("#preview-frame");
    
    try {
        const content = await fileObj.file.text();
        
        if (!content) {
            toast("Cannot preview HTML: Content missing", "bad");
            return;
        }

        frame.src = 'about:blank';
        setTimeout(() => {
            const doc = frame.contentDocument || frame.contentWindow.document;
            doc.open();
            doc.write(content);
            doc.close();
        }, 10);
        
        modal.classList.remove("hidden");
    } catch (e) {
        console.error("Failed to preview file", e);
        toast("Failed to preview file", "bad");
    }
}

async function previewOutputFile(fileObj) {
    const modal = el("#preview-modal");
    const frame = el("#preview-frame");
    
    if (fileObj.type === 'pdf') {
        let blob = fileObj.content;
        
        // If no content but we have a file handle/object (from disk load), use that
        if (!blob && fileObj.file) {
            blob = fileObj.file;
        }
        
        // Ensure it's a blob
        if (blob && !(blob instanceof Blob)) {
            blob = new Blob([blob], { type: 'application/pdf' });
        }
        
        if (!blob) {
            toast("Cannot preview PDF: Content missing", "bad");
            return;
        }

        const url = URL.createObjectURL(blob);
        frame.src = url;
        // Clean up URL when modal closes (handled in close handler)
        frame.dataset.url = url;
    } else {
        // HTML
        let content = fileObj.content;
        
        // If no content but we have a file handle/object, read it
        if (!content && fileObj.file) {
            try {
                content = await fileObj.file.text();
            } catch (e) {
                console.error("Failed to read file", e);
                toast("Failed to read file content", "bad");
                return;
            }
        }
        
        if (!content) {
            toast("Cannot preview HTML: Content missing", "bad");
            return;
        }

        frame.src = 'about:blank';
        setTimeout(() => {
            const doc = frame.contentDocument || frame.contentWindow.document;
            doc.open();
            doc.write(content);
            doc.close();
        }, 10);
    }
    
    modal.classList.remove("hidden");
}

async function printOutputFile(fileObj) {
    if (fileObj.type === 'pdf') {
        let blob = fileObj.content;
        
        if (!blob && fileObj.file) {
            blob = fileObj.file;
        }
        
        if (blob && !(blob instanceof Blob)) {
            blob = new Blob([blob], { type: 'application/pdf' });
        }
        
        if (!blob) {
            toast("Cannot print PDF: Content missing", "bad");
            return;
        }

        const url = URL.createObjectURL(blob);
        const newWindow = window.open(url, '_blank');
        // Note: Automatically printing a PDF blob in a new window is restricted in some browsers
        // The user will see the PDF and can print from there
    } else {
        let content = fileObj.content;
        
        if (!content && fileObj.file) {
            try {
                content = await fileObj.file.text();
            } catch (e) {
                toast("Failed to read file content", "bad");
                return;
            }
        }

        if (!content) {
            toast("Cannot print HTML: Content missing", "bad");
            return;
        }

        const newWindow = window.open('', '_blank');
        newWindow.document.write(content);
        newWindow.document.close();
        setTimeout(() => {
            newWindow.print();
            newWindow.close();
        }, 500);
    }
}

// Conversion process
async function convertFiles(selectedOnly = false) {
    if (STATE.conversion.isRunning) {
        toast("Conversion already in progress", "warn");
        return;
    }
    
    // Check if IBAN is configured
    if (!STATE.ibanConfig || !STATE.ibanConfig.iban || !STATE.ibanConfig.iban.trim()) {
        showIbanModal();
        return;
    }
    
    let filesToConvert = [];
    
    if (selectedOnly) {
        filesToConvert = STATE.inputFiles.filter(f => STATE.selectedInputs.has(f.id));
        // If "Convert Selected" was clicked but nothing selected, fallback to all files
        if (filesToConvert.length === 0 && STATE.inputFiles.length > 0) {
            console.log("No files selected, falling back to converting all files");
            filesToConvert = STATE.inputFiles;
            toast("Converting all files...", "good");
        }
    } else {
        filesToConvert = STATE.inputFiles;
    }
    
    if (filesToConvert.length === 0) {
        toast("No input files found. Please add HTML files first.", "warn");
        return;
    }
    
    STATE.conversion.isRunning = true;
    setFavicon('running');
    showProgress(true);
    updateProgress(0, "Starting conversion...");
    
    const keepHtml = el("#opt-keep-html").checked;
    const generatePdf = true; // Always generate PDF
    const debug = el("#opt-debug").checked;
    const overwrite = el("#opt-overwrite").checked;
    
    // If keep HTML is disabled, delete existing HTML files from output
    if (!keepHtml) {
        try {
            await deleteHtmlFilesFromOutput();
        } catch (error) {
            console.error('Failed to delete HTML files from output:', error);
        }
    }
    
    let converted = 0;
    let errors = 0;
    
    for (let i = 0; i < filesToConvert.length; i++) {
        const fileObj = filesToConvert[i];
        
        try {
            updateProgress(
                Math.round((i / filesToConvert.length) * 100),
                `Processing ${fileObj.name} (${i + 1}/${filesToConvert.length})...`
            );
            
            let data;
            // Use edited data if available
            if (fileObj.parsedData && fileObj.isEdited) {
                data = fileObj.parsedData;
                console.log(`Using edited data for ${fileObj.name}`);
            } else {
                const html = await fileObj.file.text();
                data = parseEasyInvoice(html);
            }
            
            if (!data.invoice_number) {
                console.warn(`Could not extract invoice number from ${fileObj.name}`);
            }
            
            // Load banner if configured
            let bannerDataUrl = null;
            if (STATE.config.banner_path && STATE.projectDirectoryHandle && !STATE.config.banner_path.startsWith('http') && !STATE.config.banner_path.startsWith('data:')) {
                try {
                    // Clean up path to get just the filename
                    let bannerFilename = STATE.config.banner_path;
                    if (bannerFilename.startsWith('./')) bannerFilename = bannerFilename.substring(2);
                    if (bannerFilename.startsWith('config/')) bannerFilename = bannerFilename.substring(7);
                    
                    // We assume it's in the config directory
                    const configHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('config');
                    const fileHandle = await configHandle.getFileHandle(bannerFilename);
                    const file = await fileHandle.getFile();
                    bannerDataUrl = await readFileAsDataURL(file);
                } catch (e) {
                    console.warn("Could not load banner from project:", e);
                }
            }
            
            const improvedHtml = buildImprovedHtml(data, STATE.config, STATE.ibanConfig, bannerDataUrl);
            
            // Generate filename
            const clientName = collapseWs(stripTags(data.client_name_html || ""));
            const sanitizedName = clientName.replace(/[^A-Za-z0-9_.\-]+/g, '-').replace(/\s+/g, '_') || "UNKNOWN_CLIENT";
            const sanitizedInvoice = (data.invoice_number || "UNKNOWN").replace(/[^A-Za-z0-9_.\-]+/g, '-');
            const baseFilename = `Invoice-${sanitizedInvoice}-${sanitizedName}`;
            
            // Add HTML output
            if (keepHtml) {
                const htmlFileObj = {
                    id: Date.now() + Math.random() + '_' + baseFilename + '-improved.html',
                    name: baseFilename + '-improved.html',
                    size: new Blob([improvedHtml]).size,
                    content: improvedHtml,
                    type: 'html'
                };
                
                // Check for overwrite
                const existingHtmlIndex = STATE.outputFiles.findIndex(f => f.name === htmlFileObj.name);
                if (existingHtmlIndex !== -1) {
                    if (!overwrite) {
                        console.log(`Skipping ${htmlFileObj.name} - already exists (overwrite disabled)`);
                        continue;
                    } else {
                        // Remove existing file from state to avoid duplicates
                        STATE.outputFiles.splice(existingHtmlIndex, 1);
                    }
                }
                
                STATE.outputFiles.push(htmlFileObj);
                
                // Save to output folder
                saveToOutputFolder(improvedHtml, htmlFileObj.name);
            }
            
            // Generate PDF
            if (generatePdf) {
                try {
                    const pdfBlob = await generatePdfFromHtml(improvedHtml, baseFilename + '.pdf');
                    const pdfFileObj = {
                        id: Date.now() + Math.random() + '_' + baseFilename + '.pdf',
                        name: baseFilename + '.pdf',
                        size: pdfBlob.size,
                        content: pdfBlob,
                        type: 'pdf'
                    };
                    
                    // Check for overwrite
                    const existingPdfIndex = STATE.outputFiles.findIndex(f => f.name === pdfFileObj.name);
                    if (existingPdfIndex !== -1) {
                        if (!overwrite) {
                            console.log(`Skipping ${pdfFileObj.name} - already exists (overwrite disabled)`);
                            continue;
                        } else {
                            // Remove existing file from state to avoid duplicates
                            STATE.outputFiles.splice(existingPdfIndex, 1);
                        }
                    }
                    
                    STATE.outputFiles.push(pdfFileObj);
                    
                    // Save to output folder
                    await savePdfToOutputFolder(pdfBlob, pdfFileObj.name);
                    
                } catch (pdfError) {
                    console.error(`Failed to generate PDF for ${fileObj.name}:`, pdfError);
                    errors++;
                }
            }
            
            converted++;
            
            if (debug) {
                console.log(`Converted ${fileObj.name} -> ${baseFilename}`);
            }
            
            // Show immediate feedback for each conversion
            if (keepHtml) {
                if (STATE.outputDirectoryHandle) {
                    console.log(`💾 Saved: ${baseFilename}-improved.html`);
                } else {
                    console.log(`💾 Stored: ${baseFilename}-improved.html`);
                }
            }
            if (generatePdf) {
                if (STATE.outputDirectoryHandle) {
                    console.log(`💾 Saved: ${baseFilename}.pdf`);
                } else {
                    console.log(`💾 Stored: ${baseFilename}.pdf`);
                }
            }
            
        } catch (e) {
            console.error(`Failed to convert ${fileObj.name}:`, e);
            errors++;
        }
        
        // Small delay to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    updateProgress(100, `Conversion complete. ${converted} converted, ${errors} errors.`);
    renderOutputs();
    
    setTimeout(() => {
        showProgress(false);
        let message = `Conversion complete. ${converted} file(s) converted.`;
        if (keepHtml || generatePdf) {
            if (STATE.outputDirectoryHandle) {
                message += ` Files saved to output folder.`;
            } else {
                message += ` Files stored in output list.`;
            }
        }
        if (errors > 0) {
            message += ` ${errors} error(s) occurred.`;
        }
        toast(message, errors > 0 ? "warn" : "good");
    }, 1000);
    
    STATE.conversion.isRunning = false;
    setFavicon('idle');
}

// Progress handling
function showProgress(show = true) {
    const container = el("#progress-container");
    if (show) {
        container.classList.remove("hidden");
        updateProgress(0, "Preparing...");
    } else {
        container.classList.add("hidden");
    }
}

function updateProgress(percent, text) {
    el("#progress-fill").style.width = percent + "%";
    el("#progress-text").textContent = text;
}

// Configuration modal
function renderConfigModal() {
    const c = STATE.config || {};
    const iban = STATE.ibanConfig || {};
    
    // General
    el("#cfg-banner").value = c.banner_path || "";
    updateBannerPreview(c.banner_path);
    el("#cfg-payment-request").value = c.payment_request || "";
    el("#cfg-tax-message").value = c.tax_message || "BTW (21%)";
    el("#cfg-hide-empty-fields").checked = c.hide_empty_fields !== false;
    
    // Treasurer
    el("#cfg-treasurer-name").value = (c.treasurer && c.treasurer.name) || "";
    el("#cfg-treasurer-email").value = (c.treasurer && c.treasurer.email) || "";
    el("#cfg-treasurer-title").value = (c.treasurer && c.treasurer.title) || "";
    
    // Bank
    el("#cfg-bank-bic").value = (c.bank && c.bank.bic) || "";
    el("#cfg-bank-btw").value = (c.bank && c.bank.btw_number) || "";
    el("#cfg-bank-account-name").value = (c.bank && c.bank.account_name) || "";
    el("#cfg-bank-iban").value = iban.iban || "";
    
    // Dates
    const dateSettings = c.date_settings || {};
    el("#cfg-show-date").checked = dateSettings.show_date !== false;
    el("#cfg-show-due-date").checked = dateSettings.show_due_date !== false;
    el("#cfg-date-format").value = dateSettings.date_format || "%d/%m/%Y";
    el("#cfg-due-date-format").value = dateSettings.due_date_format || "%d/%m/%Y";
    
    // Columns
    const columnSettings = c.column_settings || {};
    el("#cfg-col-show-date").checked = columnSettings.show_date !== false;
    el("#cfg-col-show-description").checked = columnSettings.show_description !== false;
    el("#cfg-col-show-action").checked = columnSettings.show_action || false;
    el("#cfg-col-show-quantity").checked = columnSettings.show_quantity || false;
    el("#cfg-col-show-price").checked = columnSettings.show_price || false;
    el("#cfg-col-show-discount").checked = columnSettings.show_discount || false;
    el("#cfg-col-show-taxable").checked = columnSettings.show_taxable || false;
    el("#cfg-col-show-tax-amount").checked = columnSettings.show_tax_amount || false;
    el("#cfg-col-show-total").checked = columnSettings.show_total !== false;
    
    // Summary
    const summarySettings = c.summary_settings || {};
    el("#cfg-summary-show-net-price").checked = summarySettings.show_net_price !== false;
    el("#cfg-summary-show-tax").checked = summarySettings.show_tax !== false;
    el("#cfg-summary-show-total-price").checked = summarySettings.show_total_price !== false;
    el("#cfg-summary-show-amount-due").checked = summarySettings.show_amount_due !== false;
}

function saveConfigFromModal() {
    const c = STATE.config || {};
    
    // General
    const bannerPath = el("#cfg-banner").value;
    c.banner_path = bannerPath ? bannerPath.trim() : "";
    
    // Validate banner path
    if (c.banner_path) {
        validateBannerPath(c.banner_path);
    }
    c.payment_request = el("#cfg-payment-request").value || null;
    c.tax_message = el("#cfg-tax-message").value || "BTW (21%)";
    c.hide_empty_fields = el("#cfg-hide-empty-fields").checked;
    
    // Treasurer
    c.treasurer = c.treasurer || {};
    c.treasurer.name = el("#cfg-treasurer-name").value || null;
    c.treasurer.email = el("#cfg-treasurer-email").value || null;
    c.treasurer.title = el("#cfg-treasurer-title").value || null;
    
    // Bank
    c.bank = c.bank || {};
    c.bank.bic = el("#cfg-bank-bic").value || null;
    c.bank.btw_number = el("#cfg-bank-btw").value || null;
    c.bank.account_name = el("#cfg-bank-account-name").value || null;
    
    // IBAN (separate config)
    const oldIban = STATE.ibanConfig?.iban || "";
    STATE.ibanConfig = STATE.ibanConfig || {};
    STATE.ibanConfig.iban = el("#cfg-bank-iban").value || null;
    
    // Save IBAN to file if it changed
    if (STATE.ibanConfig.iban !== oldIban) {
        saveIbanToFile();
    }
    
    // Date settings
    c.date_settings = c.date_settings || {};
    c.date_settings.show_date = el("#cfg-show-date").checked;
    c.date_settings.show_due_date = el("#cfg-show-due-date").checked;
    c.date_settings.date_format = el("#cfg-date-format").value || "%d/%m/%Y";
    c.date_settings.due_date_format = el("#cfg-due-date-format").value || "%d/%m/%Y";
    
    // Column settings
    c.column_settings = c.column_settings || {};
    c.column_settings.show_date = el("#cfg-col-show-date").checked;
    c.column_settings.show_description = el("#cfg-col-show-description").checked;
    c.column_settings.show_action = el("#cfg-col-show-action").checked;
    c.column_settings.show_quantity = el("#cfg-col-show-quantity").checked;
    c.column_settings.show_price = el("#cfg-col-show-price").checked;
    c.column_settings.show_discount = el("#cfg-col-show-discount").checked;
    c.column_settings.show_taxable = el("#cfg-col-show-taxable").checked;
    c.column_settings.show_tax_amount = el("#cfg-col-show-tax-amount").checked;
    c.column_settings.show_total = el("#cfg-col-show-total").checked;
    
    // Summary settings
    c.summary_settings = c.summary_settings || {};
    c.summary_settings.show_net_price = el("#cfg-summary-show-net-price").checked;
    c.summary_settings.show_tax = el("#cfg-summary-show-tax").checked;
    c.summary_settings.show_total_price = el("#cfg-summary-show-total-price").checked;
    c.summary_settings.show_amount_due = el("#cfg-summary-show-amount-due").checked;
    
    saveConfigToStorage();
    saveConfigToFile();
    toast("Configuration saved", "good");
}

async function saveConfigToFile() {
    if (!STATE.projectDirectoryHandle) return;

    try {
        const configHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('config');
        const fileHandle = await configHandle.getFileHandle('config.yml', { create: true });
        const writable = await fileHandle.createWritable();

        const c = STATE.config;
        let yaml = "";

        // Helper to dump object to YAML
        const dump = (obj, indent = 0) => {
            let res = "";
            const spaces = " ".repeat(indent);
            for (const [key, value] of Object.entries(obj)) {
                if (value === null || value === undefined) continue;
                
                if (typeof value === 'object' && !Array.isArray(value)) {
                    res += `${spaces}${key}:\n${dump(value, indent + 2)}`;
                } else if (typeof value === 'string') {
                    if (value.includes('\n')) {
                        res += `${spaces}${key}: |\n${value.split('\n').map(l => `${spaces}  ${l}`).join('\n')}\n`;
                    } else {
                        res += `${spaces}${key}: "${value.replace(/"/g, '\\"')}"\n`;
                    }
                } else {
                    res += `${spaces}${key}: ${value}\n`;
                }
            }
            return res;
        };

        // Construct config object matching structure
        const configToSave = {
            banner_path: c.banner_path,
            treasurer: c.treasurer,
            payment_request: c.payment_request,
            tax_message: c.tax_message,
            hide_empty_fields: c.hide_empty_fields,
            bank: c.bank,
            date_settings: c.date_settings,
            column_settings: c.column_settings,
            summary_settings: c.summary_settings
        };

        yaml = dump(configToSave);
        
        await writable.write(yaml);
        await writable.close();
        console.log("Saved config to config.yml");
    } catch (e) {
        console.error("Failed to save config to file:", e);
        toast("Failed to save config to file", "warn");
    }
}

function validateBannerPath(bannerPath) {
    // Check if it's a data URL
    if (bannerPath.startsWith('data:image/')) {
        return true;
    }
    
    // Check if it's an absolute URL (http/https)
    if (bannerPath.startsWith('http://') || bannerPath.startsWith('https://')) {
        return true;
    }
    
    // For File System Access API, relative paths should be in the config directory
    if (STATE.projectDirectoryHandle) {
        if (bannerPath.startsWith('../') || bannerPath.startsWith('./')) {
            // Remove ./ prefix if present
            const cleanPath = bannerPath.startsWith('./') ? bannerPath.substring(2) : bannerPath;
            toast(`Banner will be loaded from: config/${cleanPath}`, "good");
        } else {
            // Assume it's a filename in the config directory
            toast(`Banner will be loaded from: config/${bannerPath}`, "good");
        }
    } else {
        // For relative paths without File System Access API, show warning
        if (bannerPath.startsWith('../') || bannerPath.startsWith('./')) {
            toast("Note: Relative banner paths may not work in browser preview. Consider using absolute URLs or data URLs.", "warn");
        }
    }
    
    return true;
}

async function updateBannerPreview(bannerPath) {
    const previewContainer = el("#banner-preview");
    if (!previewContainer) return;
    
    if (!bannerPath || !bannerPath.trim()) {
        previewContainer.innerHTML = '<p class="hint muted small">No banner configured</p>';
        return;
    }
    
    const img = document.createElement('img');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100px';
    img.style.objectFit = 'contain';
    img.alt = 'Banner preview';
    
    img.onload = () => {
        previewContainer.innerHTML = '';
        previewContainer.appendChild(img);
    };
    
    img.onerror = () => {
        previewContainer.innerHTML = `<p class="hint muted small" style="color: var(--warn)">Banner not found: ${escapeHtml(bannerPath)}</p>`;
    };
    
    // Handle different path types
    if (bannerPath.startsWith('data:') || bannerPath.startsWith('http')) {
        img.src = bannerPath;
    } else if (STATE.projectDirectoryHandle) {
        // Try to load from project
        try {
            let filename = bannerPath;
            if (filename.startsWith('./')) filename = filename.substring(2);
            
            let handle;
            if (filename.startsWith('config/')) {
                const configHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('config');
                handle = await configHandle.getFileHandle(filename.substring(7));
            } else {
                handle = await STATE.projectDirectoryHandle.getFileHandle(filename);
            }
            
            const file = await handle.getFile();
            const url = URL.createObjectURL(file);
            img.src = url;
            
            // Clean up old blob if exists
            if (previewContainer.dataset.blobUrl) {
                URL.revokeObjectURL(previewContainer.dataset.blobUrl);
            }
            previewContainer.dataset.blobUrl = url;
            
        } catch (e) {
            console.warn("Failed to load banner preview from disk:", e);
            img.src = bannerPath; // Fallback to raw path (will likely fail but triggers onerror)
        }
    } else {
        img.src = bannerPath;
    }
}

// Edit Modal functions
let currentEditingFileId = null;
let currentEditingData = null;

async function openEditModal(fileObj) {
    currentEditingFileId = fileObj.id;
    
    try {
        // If we have cached parsed data, use it. Otherwise parse the file.
        if (!fileObj.parsedData) {
            const html = await fileObj.file.text();
            fileObj.parsedData = parseEasyInvoice(html);
        }
        
        // Clone data to avoid direct mutation until save
        currentEditingData = JSON.parse(JSON.stringify(fileObj.parsedData));
        
        // Populate fields
        el("#edit-invoice-number").value = currentEditingData.invoice_number || "";
        el("#edit-date").value = currentEditingData.date || "";
        el("#edit-due-date").value = currentEditingData.due_date || "";
        
        el("#edit-client-name").value = currentEditingData.client_name_html || "";
        el("#edit-client-address").value = currentEditingData.client_address_html || "";
        
        el("#edit-company-name").value = currentEditingData.company_name_html || "";
        el("#edit-company-address").value = currentEditingData.company_address_html || "";
        
        // Summary
        const summary = currentEditingData.summary || {};
        el("#edit-summary-net").value = summary.net || "";
        el("#edit-summary-tax").value = summary.tax || "";
        el("#edit-summary-total").value = summary.total || "";
        el("#edit-summary-due").value = summary.due || "";
        
        // Items
        renderEditItemsTable();
        
        el("#edit-modal").classList.remove("hidden");
    } catch (e) {
        console.error("Failed to open edit modal:", e);
        toast("Failed to parse file for editing", "bad");
    }
}

function renderEditItemsTable() {
    const tbody = el("#edit-items-table tbody");
    tbody.innerHTML = "";
    
    if (!currentEditingData.items) currentEditingData.items = [];
    
    currentEditingData.items.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><input type="text" class="edit-item-date" data-index="${index}" value="${escapeHtml(item.date || "")}" style="width: 100%"></td>
            <td><input type="text" class="edit-item-desc" data-index="${index}" value="${escapeHtml(item.description || "")}" style="width: 100%"></td>
            <td><input type="text" class="edit-item-qty" data-index="${index}" value="${escapeHtml(item.quantity || "")}" style="width: 60px"></td>
            <td><input type="text" class="edit-item-price" data-index="${index}" value="${escapeHtml(item.unit_price || "")}" style="width: 80px"></td>
            <td><input type="text" class="edit-item-total" data-index="${index}" value="${escapeHtml(item.total || "")}" style="width: 80px"></td>
            <td style="text-align: center;">
                <button class="btn ghost icon-only bad delete-item" data-index="${index}" title="Remove Item">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // Wire up delete buttons
    els(".delete-item", tbody).forEach(btn => {
        btn.addEventListener("click", (e) => {
            const index = parseInt(e.currentTarget.dataset.index);
            currentEditingData.items.splice(index, 1);
            renderEditItemsTable();
        });
    });
    
    // Wire up inputs to update state
    els("input", tbody).forEach(input => {
        input.addEventListener("change", (e) => {
            const index = parseInt(e.target.dataset.index);
            const fieldMap = {
                "edit-item-date": "date",
                "edit-item-desc": "description",
                "edit-item-qty": "quantity",
                "edit-item-price": "unit_price",
                "edit-item-total": "total"
            };
            
            for (const [cls, field] of Object.entries(fieldMap)) {
                if (e.target.classList.contains(cls)) {
                    currentEditingData.items[index][field] = e.target.value;
                    break;
                }
            }
        });
    });
}

function saveEditModal() {
    if (!currentEditingFileId || !currentEditingData) return;
    
    const fileObj = STATE.inputFiles.find(f => f.id === currentEditingFileId);
    if (!fileObj) return;
    
    // Update data from main fields
    currentEditingData.invoice_number = el("#edit-invoice-number").value;
    currentEditingData.date = el("#edit-date").value;
    currentEditingData.due_date = el("#edit-due-date").value;
    
    currentEditingData.client_name_html = el("#edit-client-name").value;
    currentEditingData.client_address_html = el("#edit-client-address").value;
    
    currentEditingData.company_name_html = el("#edit-company-name").value;
    currentEditingData.company_address_html = el("#edit-company-address").value;
    
    currentEditingData.summary = {
        net: el("#edit-summary-net").value,
        tax: el("#edit-summary-tax").value,
        total: el("#edit-summary-total").value,
        due: el("#edit-summary-due").value
    };
    
    // Save back to file object
    fileObj.parsedData = currentEditingData;
    fileObj.isEdited = true; // Flag to indicate manual override
    
    el("#edit-modal").classList.add("hidden");
    toast("Changes saved locally", "good");
    
    // Visual indicator in list?
    renderInputs();
}

function resetEditModal() {
    if (!currentEditingFileId) return;
    
    const fileObj = STATE.inputFiles.find(f => f.id === currentEditingFileId);
    if (!fileObj) return;
    
    if (confirm("Discard all manual changes and re-parse the original file?")) {
        delete fileObj.parsedData;
        delete fileObj.isEdited;
        openEditModal(fileObj); // Re-open to re-parse
        toast("Reset to original data", "good");
    }
}

// Event handlers
function wire() {
    // Tab switching
    els('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            els('.tab').forEach(t => t.classList.remove('active'));
            els('.tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const content = el(`#tab-${tabName}`);
            if (content) content.classList.add('active');
        });
    });
    
    // Dark mode toggle
    const themeToggle = el("#btn-theme-toggle");
    if (themeToggle) {
        // Init theme
        const savedTheme = localStorage.getItem('theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
            document.documentElement.classList.add('dark');
            document.documentElement.classList.remove('light');
            el("#icon-theme-moon").classList.add("hidden");
            el("#icon-theme-sun").classList.remove("hidden");
        } else {
            document.documentElement.classList.add('light');
            document.documentElement.classList.remove('dark');
            el("#icon-theme-moon").classList.remove("hidden");
            el("#icon-theme-sun").classList.add("hidden");
        }
        
        themeToggle.addEventListener("click", () => {
            const isDark = document.documentElement.classList.contains('dark');
            
            if (isDark) {
                // Switch to light
                document.documentElement.classList.remove('dark');
                document.documentElement.classList.add('light');
                localStorage.setItem('theme', 'light');
                
                el("#icon-theme-moon").classList.remove("hidden");
                el("#icon-theme-sun").classList.add("hidden");
            } else {
                // Switch to dark
                document.documentElement.classList.remove('light');
                document.documentElement.classList.add('dark');
                localStorage.setItem('theme', 'dark');
                
                el("#icon-theme-moon").classList.add("hidden");
                el("#icon-theme-sun").classList.remove("hidden");
            }
        });
    }
    
    // Project folder handlers
    el("#btn-select-project-folder").addEventListener("click", selectProjectFolderWithFileSystem);
    el("#btn-clear-folder").addEventListener("click", clearProjectFolder);
    
    // File input handlers (fallback if no folder selected)
    el("#input-files").addEventListener("change", (e) => {
        addInputFiles(e.target.files);
        e.target.value = ''; // Reset input
    });
    
    // Drag and drop
    // Drag and drop overlay
    const dragOverlay = el("#drag-overlay");
    let dragCounter = 0;
    
    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dragOverlay.classList.add('active');
    });
    
    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dragOverlay.classList.remove('active');
        }
    });
    
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dragOverlay.classList.remove('active');
        
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            addInputFiles(e.dataTransfer.files);
            // Switch to inputs tab
            const inputsTab = document.querySelector('.tab[data-tab="inputs"]');
            if (inputsTab) inputsTab.click();
        }
    });
    
    // Conversion buttons
    el("#btn-convert").addEventListener("click", () => convertFiles(true));
    el("#btn-convert-all").addEventListener("click", () => convertFiles(false));
    
    // Clear selected
    // Clear selected inputs
    el("#btn-clear-selected-inputs").addEventListener("click", async () => {
        const inputCount = STATE.selectedInputs.size;
        if (inputCount === 0) {
            toast("No input files selected", "warn");
            return;
        }
        
        if (confirm(`Delete ${inputCount} selected input file(s)?`)) {
            const inputsToDelete = STATE.inputFiles.filter(f => STATE.selectedInputs.has(f.id));
            
            STATE.inputFiles = STATE.inputFiles.filter(f => !STATE.selectedInputs.has(f.id));
            STATE.selectedInputs.clear();

            // Remove from disk if project folder is open
            if (STATE.projectDirectoryHandle) {
                try {
                    const inputHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('input');
                    for (const file of inputsToDelete) {
                        try {
                            await inputHandle.removeEntry(file.name);
                            console.log(`Deleted input file from disk: ${file.name}`);
                        } catch (e) {
                            console.error(`Failed to delete ${file.name} from disk:`, e);
                        }
                    }
                } catch (e) {
                    console.error("Failed to access input directory for deletion:", e);
                }
            }
            
            renderInputs();
            updateFolderStatus();
            toast(`Deleted ${inputCount} input file(s)`, "good");
        }
    });

    // Clear selected outputs
    el("#btn-clear-selected-outputs").addEventListener("click", async () => {
        const outputCount = STATE.selectedOutputs.size;
        if (outputCount === 0) {
            toast("No output files selected", "warn");
            return;
        }
        
        if (confirm(`Delete ${outputCount} selected output file(s)?`)) {
            const outputsToDelete = STATE.outputFiles.filter(f => STATE.selectedOutputs.has(f.id));
            
            // Remove from state
            STATE.outputFiles = STATE.outputFiles.filter(f => !STATE.selectedOutputs.has(f.id));
            
            // Remove from disk if possible
            if (STATE.outputDirectoryHandle) {
                let deletedCount = 0;
                for (const file of outputsToDelete) {
                    try {
                        await STATE.outputDirectoryHandle.removeEntry(file.name);
                        deletedCount++;
                    } catch (e) {
                        console.error(`Failed to delete ${file.name} from disk:`, e);
                    }
                }
                console.log(`Deleted ${deletedCount} files from disk`);
            }
            
            STATE.selectedOutputs.clear();
            renderOutputs();
            updateFolderStatus();
            toast(`Deleted ${outputCount} output file(s)`, "good");
        }
    });
    
    
    // Configuration modal
    el("#btn-edit-config").addEventListener("click", () => {
        renderConfigModal();
        el("#config-modal").classList.remove("hidden");
    });
    
    el("#cfg-cancel").addEventListener("click", () => {
        el("#config-modal").classList.add("hidden");
    });
    
    el("#cfg-save").addEventListener("click", async () => {
        const btn = el("#cfg-save");
        const originalText = btn.textContent;
        btn.textContent = "Saving...";
        btn.disabled = true;
        
        await saveConfigFromModal();
        
        btn.textContent = originalText;
        btn.disabled = false;
        el("#config-modal").classList.add("hidden");
    });
    
    // IBAN modal handlers
    el("#iban-save").addEventListener("click", saveIbanFromModal);
    el("#iban-cancel").addEventListener("click", hideIbanModal);
    
    // Close IBAN modal on backdrop click
    el("#iban-modal").addEventListener("click", (e) => {
        if (e.target === el("#iban-modal") || e.target.classList.contains("modal-backdrop")) {
            hideIbanModal();
        }
    });
    
    // Handle Enter key in IBAN input
    el("#iban-input").addEventListener("keypress", (e) => {
        if (e.key === 'Enter') {
            saveIbanFromModal();
        }
    });

    // Edit modal handlers
    el("#edit-save").addEventListener("click", saveEditModal);
    
    el("#edit-cancel").addEventListener("click", () => {
        el("#edit-modal").classList.add("hidden");
    });
    
    el("#edit-reset").addEventListener("click", resetEditModal);
    
    el("#btn-add-item").addEventListener("click", () => {
        if (!currentEditingData) return;
        if (!currentEditingData.items) currentEditingData.items = [];
        
        // Add empty item
        currentEditingData.items.push({
            date: "",
            description: "New Item",
            quantity: "1",
            unit_price: "0.00",
            total: "0.00"
        });
        
        renderEditItemsTable();
    });
    
    // Close edit modal on backdrop click
    el("#edit-modal").addEventListener("click", (e) => {
        if (e.target === el("#edit-modal") || e.target.classList.contains("modal-backdrop")) {
            el("#edit-modal").classList.add("hidden");
        }
    });
    
    // Select all checkboxes
    el("#select-all-inputs").addEventListener("change", () => {
        const checked = el("#select-all-inputs").checked;
        if (checked) {
            STATE.inputFiles.forEach(f => STATE.selectedInputs.add(f.id));
        } else {
            STATE.selectedInputs.clear();
        }
        renderInputs();
    });
    
    el("#select-all-outputs").addEventListener("change", () => {
        const checked = el("#select-all-outputs").checked;
        if (checked) {
            STATE.outputFiles.forEach(f => STATE.selectedOutputs.add(f.id));
        } else {
            STATE.selectedOutputs.clear();
        }
        renderOutputs();
    });
    
    // Close modal on backdrop click
    el("#config-modal").addEventListener("click", (e) => {
        if (e.target === el("#config-modal") || e.target.classList.contains("modal-backdrop")) {
            el("#config-modal").classList.add("hidden");
        }
    });
    
    // Banner path input listener for live preview
    el("#cfg-banner").addEventListener("input", (e) => {
        updateBannerPreview(e.target.value);
    });

    // Preview modal
    el("#preview-close").addEventListener("click", () => {
        const modal = el("#preview-modal");
        const frame = el("#preview-frame");
        
        modal.classList.add("hidden");
        
        // Clean up blob URL if it exists
        if (frame.dataset.url) {
            URL.revokeObjectURL(frame.dataset.url);
            frame.dataset.url = '';
        }
        frame.src = 'about:blank';
    });

    el("#preview-modal").addEventListener("click", (e) => {
        if (e.target === el("#preview-modal") || e.target.classList.contains("modal-backdrop")) {
            el("#preview-close").click();
        }
    });

    // Banner detection
    el("#btn-detect-banners").addEventListener("click", async () => {
        if (!STATE.projectDirectoryHandle) {
            toast("Please open a project folder first", "warn");
            return;
        }
        
        const btn = el("#btn-detect-banners");
        const originalText = btn.textContent;
        btn.textContent = "Scanning...";
        btn.disabled = true;
        
        try {
            const images = [];
            const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
            
            // Helper to scan directory
            async function scanDir(dirHandle, pathPrefix) {
                for await (const [name, handle] of dirHandle.entries()) {
                    if (handle.kind === 'file') {
                        const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
                        if (extensions.includes(ext)) {
                            images.push({
                                name: name,
                                path: pathPrefix + name,
                                handle: handle
                            });
                        }
                    }
                }
            }
            
            // Scan config directory
            try {
                const configHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('config');
                await scanDir(configHandle, 'config/');
            } catch (e) { console.log('No config dir found'); }
            
            // Scan root directory (limited)
            await scanDir(STATE.projectDirectoryHandle, '');
            
            // Render results
            const resultsContainer = el("#banner-detection-results");
            const listContainer = el("#detected-banners-list");
            listContainer.innerHTML = '';
            
            if (images.length === 0) {
                toast("No images found in project root or config folder", "warn");
                resultsContainer.classList.add("hidden");
            } else {
                resultsContainer.classList.remove("hidden");
                
                for (const img of images) {
                    const div = document.createElement('div');
                    div.className = 'detected-banner-item';
                    div.style.cssText = 'min-width: 80px; cursor: pointer; border: 1px solid var(--border); border-radius: 4px; padding: 4px; text-align: center;';
                    div.title = `Click to select: ${img.path}`;
                    
                    // Load thumbnail
                    const file = await img.handle.getFile();
                    const url = URL.createObjectURL(file);
                    
                    div.innerHTML = `
                        <div style="height: 40px; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; overflow: hidden;">
                            <img src="${url}" style="max-height: 100%; max-width: 100%; object-fit: contain;">
                        </div>
                        <div class="small muted" style="font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70px;">${img.name}</div>
                    `;
                    
                    div.addEventListener('click', () => {
                        el("#cfg-banner").value = img.path;
                        updateBannerPreview(img.path);
                        // Highlight selection
                        els('.detected-banner-item', listContainer).forEach(d => d.style.borderColor = 'var(--border)');
                        div.style.borderColor = 'var(--accent)';
                    });
                    
                    listContainer.appendChild(div);
                }
                toast(`Found ${images.length} images`, "good");
            }
            
        } catch (error) {
            console.error("Banner detection failed:", error);
            toast("Failed to scan for banners", "bad");
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
    
    // Options dropdown functionality
    const optionsButton = el("#options-button");
    const optionsDropdown = el("#options-dropdown");
    const dropdownContent = el("#dropdown-content");
    
    optionsButton.addEventListener("click", (e) => {
        e.stopPropagation();
        optionsDropdown.classList.toggle("show");
    });
    
    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
        if (!optionsDropdown.contains(e.target)) {
            optionsDropdown.classList.remove("show");
        }
    });
    
    // Prevent dropdown from closing when clicking inside
    dropdownContent.addEventListener("click", (e) => {
        e.stopPropagation();
    });
}

// Initialize
async function init() {
    loadConfigFromStorage();
    wire();
    
    // Try to restore project handle
    try {
        const handle = await getStoredDirectoryHandle();
        if (handle) {
            // Check permissions
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                console.log("Restoring project handle...");
                STATE.projectDirectoryHandle = handle;
                
                // Re-acquire sub-handles
                try {
                    const inputHandle = await handle.getDirectoryHandle('input');
                    const outputHandle = await handle.getDirectoryHandle('output');
                    const configHandle = await handle.getDirectoryHandle('config');
                    
                    STATE.outputDirectoryHandle = outputHandle;
                    await loadFilesFromDirectoryStructure(inputHandle, outputHandle, configHandle);
                    updateFolderStatus();
                    toast("Project restored", "good");
                } catch (e) {
                    console.error("Failed to restore sub-handles", e);
                    // If structure is missing, maybe just clear it
                    await clearStoredDirectoryHandle();
                }
            } else {
                console.log("Permission needed for stored handle");
                const btnOpen = el("#btn-select-project-folder");
                btnOpen.textContent = `Reconnect ${handle.name}`;
                btnOpen.classList.remove("hidden");
                el("#btn-clear-folder").classList.add("hidden");
                
                // Override click handler to request permission instead of picking new
                const originalHandler = btnOpen.onclick; // This might be null if added via addEventListener
                
                // We need to remove the existing listener to avoid double action,
                // but since we used addEventListener, we can't easily remove anonymous functions.
                // Instead, we'll clone the button to strip listeners
                const newBtn = btnOpen.cloneNode(true);
                btnOpen.parentNode.replaceChild(newBtn, btnOpen);
                
                newBtn.addEventListener("click", async () => {
                    try {
                        const newPerm = await handle.requestPermission({ mode: 'readwrite' });
                        if (newPerm === 'granted') {
                            STATE.projectDirectoryHandle = handle;
                            const inputHandle = await handle.getDirectoryHandle('input');
                            const outputHandle = await handle.getDirectoryHandle('output');
                            const configHandle = await handle.getDirectoryHandle('config');
                            
                            STATE.outputDirectoryHandle = outputHandle;
                            await loadFilesFromDirectoryStructure(inputHandle, outputHandle, configHandle);
                            updateFolderStatus();
                            
                            // Restore original button behavior
                            newBtn.textContent = "Open Project";
                            const freshBtn = newBtn.cloneNode(true);
                            newBtn.parentNode.replaceChild(freshBtn, newBtn);
                            freshBtn.addEventListener("click", selectProjectFolderWithFileSystem);
                        } else {
                            // If denied, maybe user wants to pick a different folder
                            selectProjectFolderWithFileSystem();
                        }
                    } catch (e) {
                        console.error("Permission request failed", e);
                        selectProjectFolderWithFileSystem();
                    }
                });
            }
        }
    } catch (e) {
        console.error("Failed to restore handle", e);
    }

    renderInputs();
    renderOutputs();
}

// Start the application
init();