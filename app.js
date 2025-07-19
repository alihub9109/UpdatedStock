document.addEventListener('DOMContentLoaded', function () {
    // DOM elements
    const excelFileInput = document.getElementById('excelFile');
    const loadBtn = document.querySelector('.file-input-btn');
    const searchInput = document.getElementById('searchInput');
    const stockTableBody = document.getElementById('stockTableBody');
    const itemCountSpan = document.getElementById('itemCount');
    const lastUpdatedSpan = document.getElementById('lastUpdated');
    const printSelectedBtn = document.getElementById('printSelected');
    const printModal = document.getElementById('printModal');
    const closeModal = document.querySelector('.print-modal .close-btn');
    const printBtn = document.getElementById('printBtn');
    const printQRContainer = document.getElementById('printQRContainer');
    const printQRCode = document.getElementById('printQRCode');
    const printItemName = document.getElementById('printItemName');

    // Scanner elements
    const scanBtn = document.getElementById('scanBtn');
    const scannerModal = document.getElementById('scannerModal');
    const closeScanner = document.getElementById('closeScanner');
    const scannerVideo = document.getElementById('scanner-video');
    const toggleTorch = document.getElementById('toggleTorch');
    const scannerResult = document.getElementById('scannerResult');
    const closeScannerResult = document.getElementById('closeScannerResult');
    const scannerCode = document.getElementById('scannerCode');
    const scannerName = document.getElementById('scannerName');
    const scannerQty = document.getElementById('scannerQty');
    const scannerReserve = document.getElementById('scannerReserve');

    // Global variables
    let stockData = [];
    let filteredData = [];
    let selectedItem = null;
    let scannerActive = false;
    let stream = null;
    let torchOn = false;
    let useCache = true;

    // QR Code Cache Manager with improved storage handling
    const qrCodeCache = {
        maxCacheSize: 2 * 1024 * 1024, // 2MB limit (more conservative)
        currentSize: 0,
        cachePrefix: 'qrc_', // Shorter prefix to save space
        
        init: function() {
            this.currentSize = 0;
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(this.cachePrefix)) {
                    try {
                        const item = localStorage.getItem(key);
                        if (item) this.currentSize += item.length;
                    } catch (e) {
                        console.error('Error reading cache item:', e);
                        localStorage.removeItem(key);
                    }
                }
            });
        },
        
        get: function(code) {
            if (!useCache) return null;
            
            try {
                const cached = localStorage.getItem(this.cachePrefix + code);
                return cached || null;
            } catch (e) {
                console.error('Cache read error:', e);
                this.handleCacheFull();
                return null;
            }
        },
        
        set: function(code, svg) {
            if (!useCache) return;
            
            // Skip if SVG is too large
            if (svg.length > 50000) return;
            
            try {
                // Check if we have space
                if (this.currentSize + svg.length > this.maxCacheSize) {
                    this.clearOldestItems(svg.length);
                }
                
                localStorage.setItem(this.cachePrefix + code, svg);
                this.currentSize += svg.length;
            } catch (e) {
                console.error('Cache write error:', e);
                this.handleCacheFull();
            }
        },
        
        clearOldestItems: function(requiredSpace) {
            let cleared = 0;
            const entries = [];
            
            // Collect all cache entries
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(this.cachePrefix)) {
                    const value = localStorage.getItem(key);
                    if (value) {
                        entries.push({
                            key: key,
                            size: value.length,
                            timestamp: parseInt(key.split('_')[1]) || 0
                        });
                    }
                }
            });
            
            // Sort by oldest first (by timestamp)
            entries.sort((a, b) => a.timestamp - b.timestamp);
            
            // Remove oldest items until we have enough space
            for (const entry of entries) {
                if (cleared >= requiredSpace) break;
                
                localStorage.removeItem(entry.key);
                cleared += entry.size;
                this.currentSize -= entry.size;
            }
        },
        
        clear: function() {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(this.cachePrefix)) {
                    const value = localStorage.getItem(key);
                    if (value) this.currentSize -= value.length;
                    localStorage.removeItem(key);
                }
            });
        },
        
        handleCacheFull: function() {
            console.warn('LocalStorage quota exceeded. Disabling cache.');
            useCache = false;
            this.clear();
        }
    };

    // Initialize the cache
    qrCodeCache.init();

    // Event listeners
    loadBtn.addEventListener('click', () => excelFileInput.click());
    excelFileInput.addEventListener('change', handleFileUpload);
    searchInput.addEventListener('input', filterItems);
    printSelectedBtn.addEventListener('click', showPrintModal);
    closeModal.addEventListener('click', () => printModal.style.display = 'none');
    printBtn.addEventListener('click', printSelectedQRCode);
    scanBtn.addEventListener('click', toggleScanner);
    closeScanner.addEventListener('click', toggleScanner);
    closeScannerResult.addEventListener('click', () => {
        scannerResult.style.display = 'none';
        if (scannerActive) {
            startScanner();
        }
    });
    toggleTorch.addEventListener('click', toggleTorchFunction);
    window.addEventListener('click', (event) => {
        if (event.target === printModal) {
            printModal.style.display = 'none';
        }
        if (event.target === scannerModal) {
            toggleScanner();
        }
    });

    // Handle Excel file upload with improved error handling
    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Clear cache before loading new data
        try {
            qrCodeCache.clear();
        } catch (e) {
            console.error('Error clearing cache:', e);
        }

        const reader = new FileReader();

        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Get first sheet
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to JSON with header detection
                const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                    raw: false,
                    defval: "",
                    header: detectHeaders(worksheet)
                });

                // Process data
                stockData = jsonData.map(item => {
                    if (!item) return null;
                    
                    // Normalize field names (case-insensitive)
                    const fields = {
                        code: item['Code'] || item['code'] || '',
                        name: item['Name'] || item['name'] || item['Description'] || item['description'] || '',
                        qty: parseInt(item['Qty'] || item['qty'] || item['Quantity'] || item['quantity'] || 0),
                        reserve: parseInt(item['Reserve'] || item['reserve'] || 0)
                    };

                    // Skip if no code or name
                    if (!fields.code && !fields.name) return null;

                    return {
                        code: String(fields.code).trim(),
                        name: String(fields.name).trim().replace(/\r/g, ''),
                        qty: isNaN(fields.qty) ? 0 : fields.qty,
                        reserve: isNaN(fields.reserve) ? 0 : fields.reserve,
                        available: (isNaN(fields.qty) ? 0 : fields.qty) - (isNaN(fields.reserve) ? 0 : fields.reserve)
                    };
                }).filter(item => item !== null);

                if (stockData.length === 0) {
                    throw new Error('No valid data found. Please check the Excel format.');
                }

                filteredData = [...stockData];
                renderTable();
                updateStatus();

            } catch (error) {
                console.error('Error processing Excel:', error);
                showError('Error loading Excel: ' + (error.message || 'Invalid file format'));
            }
        };

        reader.onerror = function() {
            showError('Error reading file. Please try again.');
        };

        reader.readAsArrayBuffer(file);
    }

    // Helper to detect headers in worksheet
    function detectHeaders(worksheet) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        const headers = [];
        
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = worksheet[XLSX.utils.encode_cell({r: range.s.r, c: C})];
            headers.push(cell ? String(cell.v).trim() : '');
        }
        
        return headers;
    }

    // Show error message
    function showError(message) {
        stockTableBody.innerHTML = `<tr><td colspan="6" class="error-message">${message}</td></tr>`;
        itemCountSpan.textContent = '0 items loaded';
        lastUpdatedSpan.textContent = '';
    }

    // Filter items based on search input
    function filterItems() {
        const searchTerm = searchInput.value.trim().toLowerCase();

        if (!searchTerm) {
            filteredData = [...stockData];
        } else {
            // Simple contains search (faster than regex for large datasets)
            filteredData = stockData.filter(item => 
                item.code.toLowerCase().includes(searchTerm) || 
                item.name.toLowerCase().includes(searchTerm)
            );
        }

        renderTable();
        
        // Highlight first match if any
        if (filteredData.length > 0) {
            highlightItem(filteredData[0].code);
        }
    }

    // Render the table with optimized QR code generation
    function renderTable() {
        stockTableBody.innerHTML = '';

        filteredData.forEach(item => {
            const row = document.createElement('tr');
            row.dataset.code = item.code;
            row.addEventListener('click', () => selectRow(row, item));

            // Create cells
            const cells = [
                createCell(item.code, 'Code'),
                createCell(item.name.replace(/\n/g, '<br>'), 'Name'),
                createCell(item.qty, 'QTY', 'numeric'),
                createCell(item.reserve, 'Reserve', 'numeric'),
                createCell(item.available, 'Available', 'numeric' + (item.available < 0 ? ' stock-low' : '')),
                createQRCodeCell(item.code)
            ];

            cells.forEach(cell => row.appendChild(cell));
            stockTableBody.appendChild(row);
        });

        // Mobile view handling
        document.querySelector('.table-container').classList.toggle('mobile-view', window.innerWidth < 640);
        updateStatus();
    }

    // Helper to create table cells
    function createCell(content, label, className = '') {
        const cell = document.createElement('td');
        cell.innerHTML = content;
        cell.setAttribute('data-label', label);
        if (className) cell.className = className;
        return cell;
    }

    // Create QR code cell with optimized caching
    function createQRCodeCell(code) {
        const cell = document.createElement('td');
        cell.className = 'qrcode-cell';
        cell.setAttribute('data-label', 'QR Code');

        // Try to get from cache first
        const cached = qrCodeCache.get(code);
        if (cached) {
            cell.innerHTML = cached;
            return cell;
        }

        // Generate new QR code (smaller size)
        const qr = qrcode(0, 'L');
        qr.addData(code);
        qr.make();
        
        const container = document.createElement('div');
        container.className = 'qrcode-container';
        container.innerHTML = qr.createSvgTag(1, 0); // Smaller QR code
        
        cell.appendChild(container);
        
        // Cache if possible
        try {
            qrCodeCache.set(code, container.outerHTML);
        } catch (e) {
            console.error('Failed to cache QR code:', e);
        }

        return cell;
    }

    // Highlight item in table
    function highlightItem(code) {
        document.querySelectorAll('#stockTableBody tr').forEach(row => {
            row.classList.toggle('highlight', row.dataset.code === code);
        });
        
        const row = document.querySelector(`#stockTableBody tr[data-code="${code}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Select row
    function selectRow(row, item) {
        document.querySelectorAll('#stockTableBody tr').forEach(r => {
            r.classList.remove('selected');
        });
        row.classList.add('selected');
        selectedItem = item;
    }

    // Show print modal
    function showPrintModal() {
        if (!selectedItem) {
            alert('Please select an item first by clicking on a row.');
            return;
        }

        const itemNameFirstLine = selectedItem.name.split('\n')[0].substring(0, 20);
        printItemName.textContent = itemNameFirstLine;
        printQRCode.textContent = selectedItem.code;

        // Generate QR code for printing (higher quality)
        const qr = qrcode(0, 'H'); // Higher error correction
        qr.addData(selectedItem.code);
        qr.make();
        printQRContainer.innerHTML = qr.createSvgTag(4, 0);

        printModal.style.display = 'block';
    }

    // Print QR code
    function printSelectedQRCode() {
        if (!selectedItem) return;

        const printContent = `
            <div class="sticker-container">
                <div class="sticker-name">${selectedItem.name.split('\n')[0].substring(0, 20)}</div>
                <div class="sticker-qrcode">
                    ${generateQRCodeSVG(selectedItem.code, 4)}
                </div>
                <div class="sticker-code">${selectedItem.code}</div>
            </div>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print QR Code</title>
                <style>
                    @page { size: 40mm 23mm; margin: 0; }
                    body { margin: 0; padding: 0; width: 40mm; height: 23mm; 
                           display: flex; justify-content: center; align-items: center; 
                           font-family: Arial, sans-serif; }
                    .sticker-container { text-align: center; width: 100%; padding: 1mm; box-sizing: border-box; }
                    .sticker-name { font-size: 8px; font-weight: bold; margin-bottom: 1mm; 
                                   white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .sticker-qrcode svg { width: 20mm !important; height: 20mm !important; }
                    .sticker-code { font-size: 7px; font-family: 'Courier New', monospace; margin-top: 0.5mm; }
                </style>
            </head>
            <body>${printContent}</body>
            </html>
        `);
        printWindow.document.close();
    }

    // Generate QR code SVG
    function generateQRCodeSVG(code, size) {
        const qr = qrcode(0, 'H');
        qr.addData(code);
        qr.make();
        return qr.createSvgTag(size, 0);
    }

    // Scanner functions (unchanged from your original)
    function toggleScanner() {
        if (scannerActive) {
            stopScanner();
            scannerModal.style.display = 'none';
        } else {
            scannerModal.style.display = 'block';
            startScanner();
        }
    }

    function startScanner() {
        scannerActive = true;
        scannerResult.style.display = 'none';

        navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        }).then(function(s) {
            stream = s;
            scannerVideo.srcObject = stream;
            scannerVideo.play();

            if (stream.getVideoTracks()[0].getCapabilities().torch) {
                toggleTorch.style.display = 'flex';
            }

            Quagga.init({
                inputStream: { name: "Live", type: "LiveStream", target: scannerVideo, 
                             constraints: { width: 1280, height: 720, facingMode: "environment" } },
                decoder: { readers: ["code_128_reader"] },
                locate: true
            }, function(err) {
                if (err) {
                    console.error(err);
                    return;
                }
                Quagga.start();
            });

            Quagga.onDetected(function(result) {
                const code = result.codeResult.code;
                stopScanner();
                showScannerResult(code);
            });
        }).catch(function(err) {
            console.error("Camera error:", err);
            alert("Could not access the camera. Please check permissions.");
            scannerActive = false;
            scannerModal.style.display = 'none';
        });
    }

    function stopScanner() {
        scannerActive = false;
        if (Quagga) Quagga.stop();
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        toggleTorch.style.display = 'none';
        torchOn = false;
    }

    function toggleTorchFunction() {
        if (stream) {
            const track = stream.getVideoTracks()[0];
            if (track.getCapabilities().torch) {
                torchOn = !torchOn;
                track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(e => console.error(e));
            }
        }
    }

    function showScannerResult(code) {
        const item = stockData.find(item => item.code === code);
        if (item) {
            scannerCode.textContent = item.code;
            scannerName.textContent = item.name.split('\n')[0];
            scannerQty.textContent = item.qty;
            scannerReserve.textContent = item.reserve;
            searchInput.value = code;
            filterItems();
            highlightItem(code);
            scannerResult.style.display = 'block';
        } else {
            alert('Product not found: ' + code);
            startScanner();
        }
    }

    // Update status
    function updateStatus() {
        itemCountSpan.textContent = `${filteredData.length} of ${stockData.length} items`;
        lastUpdatedSpan.textContent = `Last updated: ${new Date().toLocaleString()}`;
    }

    // Initialize with sample data (for testing)
    function initSampleData() {
        stockData = [
            { code: 'TC-1001', name: 'Ceramic Tile\nWhite 30x30cm', qty: 150, reserve: 25, available: 125 },
            { code: 'TC-1002', name: 'Porcelain Tile\nBeige 60x60cm', qty: 80, reserve: 10, available: 70 },
            { code: 'TC-1003', name: 'Mosaic Tile\nBlue 10x10cm', qty: 200, reserve: 50, available: 150 },
            { code: 'TC-1004', name: 'Wall Tile\nGreen 20x25cm', qty: 120, reserve: 30, available: 90 },
            { code: 'TC-1005', name: 'Floor Tile\nGray 45x45cm', qty: 90, reserve: 15, available: 75 }
        ];
        filteredData = [...stockData];
        renderTable();
    }

    // Start the application
    initSampleData();
});
