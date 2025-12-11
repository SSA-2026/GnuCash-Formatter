import { STATE, DEFAULT_CONFIG, DEFAULT_IBAN_CONFIG } from './state.js';
import { el, els, toast, setFavicon, readFileAsDataURL, formatBytes, collapseWs, stripTags } from './utils.js';
import {
    storeDirectoryHandle, getStoredDirectoryHandle, clearStoredDirectoryHandle,
    loadConfigFromStorage, saveConfigToStorage, saveToOutputFolder,
    savePdfToOutputFolder, deleteHtmlFilesFromOutput
} from './storage.js';
import { parseEasyInvoice } from './parser.js';
import { buildImprovedHtml } from './generator.js';
import { generatePdfFromHtml } from './pdf.js';

// --- Main Application Logic ---

async function init() {
    // Initialize Alpine.js store first
    if (window.initAlpine) {
        window.initAlpine();
    }
    
    loadConfigFromStorage(updateFolderStatus);
    wireEvents();
    
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

    renderInputs({
        onPreviewInput: previewInputFile,
        onEditInput: openEditModal
    });
    renderOutputs({
        onPreviewOutput: previewOutputFile,
        onPrintOutput: printOutputFile
    });
}

// --- File System Logic ---

async function selectProjectFolderWithFileSystem() {
    try {
        if ('showDirectoryPicker' in window) {
            const directoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            
            // Ensure the required directory structure exists
            await ensureDirectoryStructure(directoryHandle);
            
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
        renderInputs({
            onPreviewInput: previewInputFile,
            onEditInput: openEditModal
        });
        renderOutputs({
            onPreviewOutput: previewOutputFile,
            onPrintOutput: printOutputFile
        });
        
        const configCount = Object.keys(configFiles).length;
        toast(`Loaded project: ${inputFiles.length} input files, ${outputFiles.length} output files, ${configCount} config files`, "good");
        
    } catch (error) {
        console.error('Failed to load files from directory structure:', error);
        toast("Failed to load project files: " + error.message, "bad");
    }
}

async function clearProjectFolder() {
    STATE.projectFolder = null;
    STATE.inputFiles = [];
    STATE.outputFiles = [];
    STATE.selectedInputs.clear();
    STATE.selectedOutputs.clear();
    
    await clearStoredDirectoryHandle();

    renderInputs({
        onPreviewInput: previewInputFile,
        onEditInput: openEditModal
    });
    renderOutputs({
        onPreviewOutput: previewOutputFile,
        onPrintOutput: printOutputFile
    });
    updateFolderStatus();
    
    toast("Project folder cleared", "good");
}

// --- Conversion Logic ---

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
    
    const keepHtml = window.AlpineStore ? window.AlpineStore.conversionOptions.keepHtml : el("#opt-keep-html").checked;
    const generatePdf = true; // Always generate PDF
    const debug = window.AlpineStore ? window.AlpineStore.conversionOptions.debug : el("#opt-debug").checked;
    const overwrite = window.AlpineStore ? window.AlpineStore.conversionOptions.overwrite : el("#opt-overwrite").checked;
    
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
            
            const improvedHtml = await buildImprovedHtml(data, STATE.config, STATE.ibanConfig);
            
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
                    // Get PDF quality settings from UI
                    const pdfQualityOptions = {
                        quality: window.AlpineStore ? window.AlpineStore.conversionOptions.pdfQuality : 1.0,
                        scale: window.AlpineStore ? window.AlpineStore.conversionOptions.pdfScale : 3.0,
                        format: window.AlpineStore ? window.AlpineStore.conversionOptions.pdfFormat : 'jpeg',
                        compress: window.AlpineStore ? window.AlpineStore.conversionOptions.pdfCompress : true
                    };
                    
                    const pdfBlob = await generatePdfFromHtml(improvedHtml, baseFilename + '.pdf', pdfQualityOptions);
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
            
        } catch (e) {
            console.error(`Failed to convert ${fileObj.name}:`, e);
            errors++;
        }
        
        // Small delay to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    updateProgress(100, `Conversion complete. ${converted} converted, ${errors} errors.`);
    renderOutputs({
        onPreviewOutput: previewOutputFile,
        onPrintOutput: printOutputFile
    });
    
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

// --- Helper Functions ---

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

// --- Modal & Event Handlers ---

function showIbanModal() {
    openIbanModal(STATE.ibanConfig?.iban);
}

function saveIbanFromEvent({ iban }) {
    STATE.ibanConfig = STATE.ibanConfig || {};
    STATE.ibanConfig.iban = iban;
    
    saveConfigToStorage();
    saveIbanToFile();
    toast("IBAN saved successfully", "good");
    
    // Retry the conversion
    setTimeout(() => {
        convertFiles(false);
    }, 500);
}

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

async function previewInputFile(fileObj) {
    openPreviewModal(`Preview: ${fileObj.name}`);
    const frame = document.getElementById("preview-frame");
    
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
    } catch (e) {
        console.error("Failed to preview file", e);
        toast("Failed to preview file", "bad");
    }
}

async function previewOutputFile(fileObj) {
    openPreviewModal(`Preview: ${fileObj.name}`);
    const frame = document.getElementById("preview-frame");
    
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
        newWindow.document.title = fileObj.name;
        newWindow.document.close();
        setTimeout(() => {
            newWindow.print();
            newWindow.close();
        }, 500);
    }
}

// Edit Modal Logic
let currentEditingFileId = null;
let currentEditingData = null;

async function openEditModal(fileObj) {
    try {
        // If we have cached parsed data, use it. Otherwise parse the file.
        if (!fileObj.parsedData) {
            const html = await fileObj.file.text();
            fileObj.parsedData = parseEasyInvoice(html);
        }
        
        openEditModal(fileObj.id, fileObj.parsedData);
    } catch (e) {
        console.error("Failed to open edit modal:", e);
        toast("Failed to parse file for editing", "bad");
    }
}

function saveEditFromEvent({ id, data }) {
    const fileObj = STATE.inputFiles.find(f => f.id === id);
    if (!fileObj) return;
    
    // Save back to file object
    fileObj.parsedData = data;
    fileObj.isEdited = true; // Flag to indicate manual override
    
    toast("Changes saved locally", "good");
}

function resetEditFromEvent({ id }) {
    const fileObj = STATE.inputFiles.find(f => f.id === id);
    if (!fileObj) return;
    
    delete fileObj.parsedData;
    delete fileObj.isEdited;
    openEditModal(fileObj); // Re-open to re-parse
    toast("Reset to original data", "good");
}

// saveConfigFromModal removed - handled by Alpine and config-saved event

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

function wireEvents() {
    // Main button event listeners
    const btnSelectProjectFolder = el("#btn-select-project-folder");
    if (btnSelectProjectFolder) {
        btnSelectProjectFolder.addEventListener("click", selectProjectFolderWithFileSystem);
    }
    
    const btnClearFolder = el("#btn-clear-folder");
    if (btnClearFolder) {
        btnClearFolder.addEventListener("click", clearProjectFolder);
    }
    
    // Convert buttons are now handled by the Alpine dropdown
    
    const btnClearSelectedInputs = el("#btn-clear-selected-inputs");
    if (btnClearSelectedInputs) {
        btnClearSelectedInputs.addEventListener("click", deleteSelectedInputs);
    }
    
    const btnClearSelectedOutputs = el("#btn-clear-selected-outputs");
    if (btnClearSelectedOutputs) {
        btnClearSelectedOutputs.addEventListener("click", deleteSelectedOutputs);
    }

    // Listen for Alpine events
    window.addEventListener('config-saved', async () => {
        await saveConfigToStorage(updateFolderStatus);
        await saveConfigToFile();
        toast("Configuration saved", "good");
    });

    window.addEventListener('edit-saved', (e) => {
        saveEditFromEvent(e.detail);
    });
    
    window.addEventListener('edit-reset', (e) => {
        resetEditFromEvent(e.detail);
    });
    
    window.addEventListener('iban-saved', (e) => {
        saveIbanFromEvent(e.detail);
    });

    // File input handlers (fallback if no folder selected)
    const fileInput = el("#input-files");
    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
            const newFiles = [];
            for (const file of e.target.files) {
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
                renderInputs({
                    onPreviewInput: previewInputFile,
                    onEditInput: openEditModal
                });
                toast(`Added ${newFiles.length} file(s)`, "good");
            } else {
                toast("No HTML files found", "warn");
            }
            e.target.value = ''; // Reset input
        });
    }
    
    // Drag and drop
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
            const newFiles = [];
            for (const file of e.dataTransfer.files) {
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
                renderInputs({
                    onPreviewInput: previewInputFile,
                    onEditInput: openEditModal
                });
                toast(`Added ${newFiles.length} file(s)`, "good");
                // Switch to inputs tab via Alpine
                if (window.AlpineStore) window.AlpineStore.activeTab = 'inputs';
            }
        }
    });
    
    // Theme toggle logic handled by Alpine
}

// Exposed functions for Alpine
async function deleteSelectedInputs() {
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
        
        renderInputs({
            onPreviewInput: previewInputFile,
            onEditInput: openEditModal
        });
        updateFolderStatus();
        toast(`Deleted ${inputCount} input file(s)`, "good");
    }
}

async function deleteSelectedOutputs() {
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
        renderOutputs({
            onPreviewOutput: previewOutputFile,
            onPrintOutput: printOutputFile
        });
        updateFolderStatus();
        toast(`Deleted ${outputCount} output file(s)`, "good");
    }
}

async function detectBanners() {
    if (!STATE.projectDirectoryHandle) {
        toast("Please open a project folder first", "warn");
        return;
    }
    
    // Button state is handled by Alpine binding if possible, but we can try to find it
    // Since it's inside a modal that might not be rendered, we rely on Alpine state mostly
    // But for visual feedback on the button itself if it exists:
    const btn = document.getElementById("btn-detect-banners");
    if (btn) {
        btn.textContent = "Scanning...";
        btn.disabled = true;
    }
    
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
        
        if (images.length === 0) {
            toast("No images found in project root or config folder", "warn");
            if (window.AlpineStore) window.AlpineStore.detectedBanners = [];
        } else {
            // Process images for display (create URLs)
            const processedImages = await Promise.all(images.map(async (img) => {
                const file = await img.handle.getFile();
                const url = URL.createObjectURL(file);
                return {
                    name: img.name,
                    path: img.path,
                    url: url
                };
            }));
            
            if (window.AlpineStore) {
                // Revoke old URLs to avoid memory leaks
                if (window.AlpineStore.detectedBanners) {
                    window.AlpineStore.detectedBanners.forEach(b => URL.revokeObjectURL(b.url));
                }
                window.AlpineStore.detectedBanners = processedImages;
            }
            
            toast(`Found ${images.length} images`, "good");
        }
        
    } catch (error) {
        console.error("Banner detection failed:", error);
        toast("Failed to scan for banners", "bad");
    } finally {
        if (btn) {
            btn.textContent = "Detect";
            btn.disabled = false;
        }
    }
}

// Expose STATE and functions to window for Alpine
window.STATE = STATE;
window.selectProjectFolderWithFileSystem = selectProjectFolderWithFileSystem;
window.clearProjectFolder = clearProjectFolder;
window.convertFiles = convertFiles;
window.deleteSelectedInputs = deleteSelectedInputs;
window.deleteSelectedOutputs = deleteSelectedOutputs;
window.detectBanners = detectBanners;

// Start the application
init();