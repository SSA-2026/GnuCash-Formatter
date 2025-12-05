// Invoice Formatter - Static Version
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
    if (STATE.projectFolder) {
        const inputCount = STATE.inputFiles.length;
        const outputCount = STATE.outputFiles.length;
        const hasConfig = STATE.config && STATE.ibanConfig;
        
        let statusText = `📁 ${STATE.projectFolder.name} - `;
        statusText += `${inputCount} input files, ${outputCount} output files`;
        
        if (hasConfig) {
            statusText += " - ✅ Config loaded";
            status.style.color = "var(--good)";
        } else {
            statusText += " - ⚠️ No config found";
            status.style.color = "var(--warn)";
        }
        
        status.textContent = statusText;
    } else {
        status.textContent = "No folder selected";
        status.style.color = "var(--muted)";
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

// PDF generation from HTML using jsPDF and html2canvas
async function generatePdfFromHtml(htmlContent, filename) {
    return new Promise(async (resolve, reject) => {
        try {
            // Wait for libraries to be loaded with timeout
            const waitForLibraries = async () => {
                const maxWaitTime = 10000; // 10 seconds
                const checkInterval = 100; // 100ms
                let waited = 0;
                
                while (waited < maxWaitTime) {
                    if (typeof window.jsPDF !== 'undefined' && typeof window.html2canvas !== 'undefined') {
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    waited += checkInterval;
                }
                return false;
            };

            // Check if jsPDF and html2canvas are loaded
            const librariesLoaded = await waitForLibraries();
            if (!librariesLoaded) {
                throw new Error('PDF libraries failed to load. Please check your internet connection and refresh the page.');
            }

            // Create a temporary container for the HTML content
            const tempContainer = document.createElement('div');
            tempContainer.style.position = 'absolute';
            tempContainer.style.left = '-9999px';
            tempContainer.style.top = '0';
            tempContainer.style.width = '1006px'; // Match the banner width
            tempContainer.style.backgroundColor = 'white';
            tempContainer.innerHTML = htmlContent;
            document.body.appendChild(tempContainer);

            // Wait a bit for images to load
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Use html2canvas to capture the HTML as an image
            const canvas = await html2canvas(tempContainer, {
                scale: 2, // Higher quality
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                width: 1006,
                windowWidth: 1006
            });

            // Remove the temporary container
            document.body.removeChild(tempContainer);

            // Create PDF
            const { jsPDF } = window.jsPDF;
            const pdf = new jsPDF({
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

            // Add the image to PDF
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            // Add new pages if content is longer than one page
            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            // Generate PDF blob
            const pdfBlob = pdf.output('blob');
            resolve(pdfBlob);

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

function clearProjectFolder() {
    STATE.projectFolder = null;
    STATE.inputFiles = [];
    STATE.outputFiles = [];
    STATE.selectedInputs.clear();
    STATE.selectedOutputs.clear();
    
    renderInputs();
    renderOutputs();
    updateFolderStatus();
    
    toast("Project folder cleared", "good");
}

function parseSimpleYaml(text) {
    const result = {};
    const lines = text.split('\n');
    const stack = [{ obj: result, indent: -1 }];
    
    for (let line of lines) {
        const originalLine = line;
        line = line.trim();
        
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
                // Multiline string (simplified - just take next non-empty line)
                const nextLineIndex = lines.indexOf(originalLine) + 1;
                let multilineValue = '';
                for (let i = nextLineIndex; i < lines.length; i++) {
                    const nextLine = lines[i].trim();
                    if (nextLine && !nextLine.startsWith('#')) {
                        multilineValue = nextLine.replace(/^["']|["']$/g, '');
                        break;
                    }
                }
                current[key] = multilineValue;
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

function buildImprovedHtml(data, config, ibanConfig) {
    const c = config || {};
    const iban = ibanConfig || {};
    
    let bannerHtml = "";
    if (c.banner_path) {
        // If using File System Access API, construct the path relative to the project directory
        if (STATE.projectDirectoryHandle && !c.banner_path.startsWith('http') && !c.banner_path.startsWith('data:')) {
            // For relative paths, assume they're in the config directory
            const bannerPath = c.banner_path.startsWith('./') ? c.banner_path.substring(2) : c.banner_path;
            bannerHtml = `<tr><td align="left"><img src="./config/${bannerPath}" alt="Invoice Banner" onerror="this.style.display='none'; this.alt='Banner not found: config/${bannerPath}';" /></td></tr>`;
        } else {
            // For absolute URLs or data URLs, use as-is
            bannerHtml = `<tr><td align="left"><img src="${escapeHtml(c.banner_path)}" alt="Invoice Banner" onerror="this.style.display='none'; this.alt='Banner not found: ${escapeHtml(c.banner_path)}';" /></td></tr>`;
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
    
    return `<!DOCTYPE html>
<html dir='auto'>
<head>
<meta http-equiv="content-type" content="text/html; charset=utf-8" />
<style type="text/css">
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');

* {
    box-sizing: border-box;
}

body {
    font-family: "Open Sans", sans-serif;
    background-color: #ffffff;
    color: #000000;
    margin: 0;
    padding: 20px;
    line-height: 1.4;
}

.invoice-container {
    max-width: 1006px;
    margin: 0 auto;
    background: white;
    padding: 0;
}

img {
    max-width: 100%;
    width: 1006px;
    display: block;
    margin-left: auto;
    margin-right: auto;
    height: auto;
}

h3 {
    font-family: "Open Sans", sans-serif;
    font-size: 15pt;
    font-weight: bold;
    margin: 10px 0;
}

a {
    font-family: "Open Sans", sans-serif;
    font-size: 10pt;
    font-style: italic;
}

table {
    border-collapse: collapse;
    width: 100%;
    margin: 0;
}

table td, table th {
    border: 1px solid #ccc;
    padding: 8px;
    vertical-align: top;
    font-family: "Open Sans", sans-serif;
    font-size: 11pt;
}

th {
    background-color: #f5f5f5;
    font-weight: 600;
    text-align: left;
}

.number-cell, .total-number-cell {
    text-align: right;
    white-space: nowrap;
    font-family: "Open Sans", sans-serif;
    font-size: 12pt;
}

.total-label-cell {
    font-family: "Open Sans", sans-serif;
    font-size: 12pt;
    font-weight: 600;
}

.total-number-cell {
    font-weight: 600;
}

.date-cell {
    white-space: nowrap;
}

.invoice-title {
    font-size: 18pt;
    font-weight: bold;
    margin: 20px 0;
    text-align: center;
}

.company-name, .client-name {
    font-size: 16pt;
    font-weight: 600;
    margin: 0 0 5px 0;
    line-height: 1.25;
}

.client-address, .company-address {
    font-size: 11pt;
    line-height: 1.4;
    margin: 0;
}

.invoice-details-table td {
    padding: 4px 8px;
    border: none;
}

.invoice-details-table td:first-child {
    font-weight: 600;
}

.entries-table {
    margin: 20px 0;
}

.entries-table th {
    background-color: #92a7b6;
    color: white;
    font-weight: 600;
    text-align: left;
    padding: 10px 8px;
}

.entries-table td {
    border: 1px solid #ddd;
    padding: 8px;
}

.entries-table tr:nth-child(even) {
    background-color: #f9f9f9;
}

.entries-table tr:first-child td {
    background-color: #92a7b6;
    color: white;
    font-weight: 600;
}

.invoice-notes {
    margin-top: 30px;
    font-size: 11pt;
    line-height: 1.6;
    white-space: pre-line;
}

.div-align-right {
    text-align: right;
}

.div-align-right .maybe-align-right {
    text-align: right;
}

@media print {
    body {
        margin: 0;
        padding: 0;
        background: white;
    }
    
    .invoice-container {
        margin: 0;
        max-width: 100%;
    }
    
    .entries-table tr {
        page-break-inside: avoid;
    }
    
    .invoice-notes {
        page-break-inside: avoid;
    }
}
</style>
</head>
<body>
<div class="invoice-container">
    ${bannerHtml}
    
    <div class="invoice-title">Invoice #${escapeHtml(data.invoice_number || "")}</div>
    
    <table style="margin-bottom: 30px;">
        <tr>
            <td style="width: 50%; vertical-align: top; padding-right: 20px;">
                <div class="client-name">${data.client_name_html || ""}</div>
                <div class="client-address">${data.client_address_html || ""}</div>
            </td>
            <td style="width: 50%; vertical-align: top; text-align: right;">
                <div class="company-name">${data.company_name_html || ""}</div>
                <div class="company-address">${data.company_address_html || ""}</div>
                
                <div class="invoice-details-table" style="margin-top: 20px;">
                    <table>
                        ${showDate ? `<tr><td>Date:</td><td style="text-align: right;">${escapeHtml(data.date || "")}</td></tr>` : ''}
                        ${showDueDate ? `<tr><td>Due Date:</td><td style="text-align: right;">${escapeHtml(data.due_date || "")}</td></tr>` : ''}
                    </table>
                </div>
            </td>
        </tr>
    </table>
    
    <div class="entries-table">
        <table>
            <thead>
                <tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${itemRows.join('')}
                ${summaryHtml}
            </tbody>
        </table>
    </div>
    
    <div class="invoice-notes">${notesHtml}</div>
</div>
</body>
</html>`;
}

// UI rendering
function renderInputs() {
    const box = el("#inputs-list");
    const dropZone = el("#drop-zone");
    
    if (STATE.inputFiles.length === 0) {
        box.classList.add("hidden");
        dropZone.classList.remove("hidden");
        return;
    }
    
    box.classList.remove("hidden");
    dropZone.classList.add("hidden");
    
    // Clear existing rows
    els(".rowi", box).forEach(n => n.remove());
    
    STATE.inputFiles.forEach(file => {
        const row = document.createElement("div");
        row.className = "rowi";
        row.innerHTML = `
            <div><input type="checkbox" class="pick" data-id="${file.id}" /></div>
            <div class="mono" title="${file.name}">${file.name}<div class="pill">${formatBytes(file.size)}</div></div>
            <div class="actions">
                <button class="btn ghost small preview" data-id="${file.id}">👁️ Preview</button>
                <button class="btn ghost small remove" data-id="${file.id}">🗑️ Remove</button>
            </div>
        `;
        box.appendChild(row);
        
        const checkbox = row.querySelector("input.pick");
        checkbox.checked = STATE.selectedInputs.has(file.id);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                STATE.selectedInputs.add(file.id);
            } else {
                STATE.selectedInputs.delete(file.id);
            }
            updateSelectAllCheckbox('inputs');
        });
        
        row.querySelector("button.preview").addEventListener("click", () => {
            previewInputFile(file);
        });
        
        row.querySelector("button.remove").addEventListener("click", () => {
            removeInputFile(file.id);
        });
    });
    
    updateSelectAllCheckbox('inputs');
}

function renderOutputs() {
    const box = el("#outputs-list");
    
    // Clear existing rows
    els(".rowi", box).forEach(n => n.remove());
    
    STATE.outputFiles.forEach(file => {
        const row = document.createElement("div");
        row.className = "rowi";
        row.innerHTML = `
            <div><input type="checkbox" class="pick" data-id="${file.id}" /></div>
            <div class="mono" title="${file.name}">${file.name}<div class="pill">${formatBytes(file.size)}</div></div>
            <div class="actions">
                <button class="btn ghost small preview" data-id="${file.id}">👁️ Preview</button>
                <button class="btn ghost small download" data-id="${file.id}">📥 Download</button>
                <button class="btn ghost small print" data-id="${file.id}">🖨️ Print</button>
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
        
        row.querySelector("button.download").addEventListener("click", () => {
            downloadOutputFile(file);
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

function removeInputFile(fileId) {
    STATE.inputFiles = STATE.inputFiles.filter(f => f.id !== fileId);
    STATE.selectedInputs.delete(fileId);
    renderInputs();
}

async function previewInputFile(fileObj) {
    try {
        const text = await fileObj.file.text();
        const newWindow = window.open('', '_blank');
        newWindow.document.write(text);
        newWindow.document.close();
    } catch (e) {
        toast("Failed to preview file", "bad");
    }
}

function previewOutputFile(fileObj) {
    const newWindow = window.open('', '_blank');
    newWindow.document.write(fileObj.content);
    newWindow.document.close();
}

function downloadOutputFile(fileObj) {
    const mimeType = fileObj.type === 'pdf' ? 'application/pdf' : 'text/html';
    downloadFile(fileObj.content, fileObj.name, mimeType);
}

function printOutputFile(fileObj) {
    const newWindow = window.open('', '_blank');
    newWindow.document.write(fileObj.content);
    newWindow.document.close();
    newWindow.print();
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
    
    const filesToConvert = selectedOnly ?
        STATE.inputFiles.filter(f => STATE.selectedInputs.has(f.id)) :
        STATE.inputFiles;
    
    if (filesToConvert.length === 0) {
        toast("No files to convert", "warn");
        return;
    }
    
    STATE.conversion.isRunning = true;
    showProgress(true);
    updateProgress(0, "Starting conversion...");
    
    const keepHtml = el("#opt-keep-html").checked;
    const generatePdf = el("#opt-generate-pdf").checked;
    const debug = el("#opt-debug").checked;
    const overwrite = el("#opt-overwrite").checked;
    
    let converted = 0;
    let errors = 0;
    
    for (let i = 0; i < filesToConvert.length; i++) {
        const fileObj = filesToConvert[i];
        
        try {
            updateProgress(
                Math.round((i / filesToConvert.length) * 100),
                `Processing ${fileObj.name} (${i + 1}/${filesToConvert.length})...`
            );
            
            const html = await fileObj.file.text();
            const data = parseEasyInvoice(html);
            
            if (!data.invoice_number) {
                console.warn(`Could not extract invoice number from ${fileObj.name}`);
            }
            
            const improvedHtml = buildImprovedHtml(data, STATE.config, STATE.ibanConfig);
            
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
                if (!overwrite) {
                    const existingIndex = STATE.outputFiles.findIndex(f => f.name === htmlFileObj.name);
                    if (existingIndex !== -1) {
                        console.log(`Skipping ${htmlFileObj.name} - already exists (overwrite disabled)`);
                        continue;
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
                    if (!overwrite) {
                        const existingIndex = STATE.outputFiles.findIndex(f => f.name === pdfFileObj.name);
                        if (existingIndex !== -1) {
                            console.log(`Skipping ${pdfFileObj.name} - already exists (overwrite disabled)`);
                            continue;
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
    
    // General tab
    el("#cfg-banner").value = c.banner_path || "";
    
    // Add banner preview if path exists
    updateBannerPreview(c.banner_path);
    el("#cfg-treasurer-name").value = (c.treasurer && c.treasurer.name) || "";
    el("#cfg-treasurer-email").value = (c.treasurer && c.treasurer.email) || "";
    el("#cfg-treasurer-title").value = (c.treasurer && c.treasurer.title) || "";
    el("#cfg-payment-request").value = c.payment_request || "";
    el("#cfg-tax-message").value = c.tax_message || "BTW (21%)";
    el("#cfg-hide-empty-fields").checked = c.hide_empty_fields !== false;
    
    // Bank tab
    el("#cfg-bank-bic").value = (c.bank && c.bank.bic) || "";
    el("#cfg-bank-btw").value = (c.bank && c.bank.btw_number) || "";
    el("#cfg-bank-account-name").value = (c.bank && c.bank.account_name) || "";
    el("#cfg-bank-iban").value = iban.iban || "";
    
    // Dates tab
    const dateSettings = c.date_settings || {};
    el("#cfg-show-date").checked = dateSettings.show_date !== false;
    el("#cfg-show-due-date").checked = dateSettings.show_due_date !== false;
    el("#cfg-date-format").value = dateSettings.date_format || "%d/%m/%Y";
    el("#cfg-due-date-format").value = dateSettings.due_date_format || "%d/%m/%Y";
    
    // Columns tab
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
    
    // Summary tab
    const summarySettings = c.summary_settings || {};
    el("#cfg-summary-show-net-price").checked = summarySettings.show_net_price !== false;
    el("#cfg-summary-show-tax").checked = summarySettings.show_tax !== false;
    el("#cfg-summary-show-total-price").checked = summarySettings.show_total_price !== false;
    el("#cfg-summary-show-amount-due").checked = summarySettings.show_amount_due !== false;
}

function saveConfigFromModal() {
    const c = STATE.config || {};
    
    // General
    const bannerPath = el("#cfg-banner").value || null;
    c.banner_path = bannerPath;
    
    // Validate banner path
    if (bannerPath && bannerPath.trim()) {
        validateBannerPath(bannerPath);
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
    toast("Configuration saved", "good");
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

function updateBannerPreview(bannerPath) {
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
    
    img.src = bannerPath;
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
    
    // Project folder handlers
    el("#btn-select-project-folder").addEventListener("click", selectProjectFolderWithFileSystem);
    el("#btn-clear-folder").addEventListener("click", clearProjectFolder);
    
    // File input handlers (fallback if no folder selected)
    el("#input-files").addEventListener("change", (e) => {
        addInputFiles(e.target.files);
        e.target.value = ''; // Reset input
    });
    
    // Drag and drop
    const dropZone = el("#drop-zone");
    const inputsCard = el("#inputs-card");
    
    [dropZone, inputsCard].forEach(element => {
        element.addEventListener('dragover', e => {
            e.preventDefault();
            element.style.borderColor = 'var(--accent)';
            element.style.backgroundColor = 'rgba(28, 126, 214, 0.1)';
        });
        
        element.addEventListener('dragleave', e => {
            e.preventDefault();
            element.style.borderColor = 'var(--border)';
            element.style.backgroundColor = 'transparent';
        });
        
        element.addEventListener('drop', e => {
            e.preventDefault();
            element.style.borderColor = 'var(--border)';
            element.style.backgroundColor = 'transparent';
            addInputFiles(e.dataTransfer.files);
        });
    });
    
    // Conversion buttons
    el("#btn-convert").addEventListener("click", () => convertFiles(true));
    el("#btn-convert-all").addEventListener("click", () => convertFiles(false));
    
    // Clear selected
    el("#btn-clear-selected").addEventListener("click", () => {
        const selectedCount = STATE.selectedInputs.size;
        if (selectedCount === 0) {
            toast("No files selected", "warn");
            return;
        }
        
        if (confirm(`Delete ${selectedCount} selected file(s)?`)) {
            STATE.inputFiles = STATE.inputFiles.filter(f => !STATE.selectedInputs.has(f.id));
            STATE.selectedInputs.clear();
            renderInputs();
            toast(`Deleted ${selectedCount} file(s)`, "good");
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
    
    el("#cfg-save").addEventListener("click", () => {
        saveConfigFromModal();
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
function init() {
    loadConfigFromStorage();
    wire();
    renderInputs();
    renderOutputs();
}

// Start the application
init();