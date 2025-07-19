document.addEventListener('DOMContentLoaded', function() {
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
    const printBarcodeSvg = document.getElementById('printBarcode');
    const printBarcodeCode = document.getElementById('printBarcodeCode');
    
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

    // Barcode Cache Manager
    const barcodeCache = {
        get: function(code) {
            const cached = localStorage.getItem(`barcode_${code}`);
            return cached ? cached : null;
        },
        set: function(code, svg) {
            localStorage.setItem(`barcode_${code}`, svg);
        },
        clear: function() {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('barcode_')) {
                    localStorage.removeItem(key);
                }
            });
        },
        clearExpired: function(maxAgeDays = 30) {
            const now = Date.now();
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('barcode_')) {
                    const entry = JSON.parse(localStorage.getItem(key));
                    if (entry && now - entry.timestamp > maxAgeDays * 86400000) {
                        localStorage.removeItem(key);
                    }
                }
            });
        }
    };

    // Event listeners
    loadBtn.addEventListener('click', () => excelFileInput.click());
    excelFileInput.addEventListener('change', handleFileUpload);
    searchInput.addEventListener('input', filterItems);
    printSelectedBtn.addEventListener('click', showPrintModal);
    closeModal.addEventListener('click', () => printModal.style.display = 'none');
    printBtn.addEventListener('click', printBarcode);
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

    // Handle Excel file upload
    function handleFileUpload(event) {
        barcodeCache.clear();
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Get first sheet
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            
            // Convert to JSON
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: ['code', 'name', 'qty', 'reserve'] });
            
            // Remove header row if exists
            if (jsonData[0] && jsonData[0].code === 'Code') {
                jsonData.shift();
            }
            
            // Process data
            stockData = jsonData.map(item => ({
                code: item.code?.toString() || '',
                name: item.name?.toString() || '',
                qty: parseInt(item.qty) || 0,
                reserve: parseInt(item.reserve) || 0,
                available: (parseInt(item.qty) || 0) - (parseInt(item.reserve) || 0)
            }));
            
            // Initial render
            filteredData = [...stockData];
            renderTable();
            updateStatus();
        };
        reader.readAsArrayBuffer(file);
    }

    // Filter items based on search input
    function filterItems() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        
        if (!searchTerm) {
            filteredData = [...stockData];
        } else {
            filteredData = stockData.filter(item => 
                item.code.toLowerCase().includes(searchTerm)
            );
        }
        
        renderTable();
        
        // Highlight and scroll to the first matching item
        if (filteredData.length > 0) {
            highlightItem(filteredData[0].code);
        }
    }

    // Render the table with filtered data
    function renderTable() {
        // Clear existing rows
        stockTableBody.innerHTML = '';
        
        // Create new rows
        filteredData.forEach(item => {
            const row = document.createElement('tr');
            row.dataset.code = item.code;
            
            // Add click event to select row
            row.addEventListener('click', () => {
                selectRow(row, item);
            });
            
            // Create cells
            const codeCell = document.createElement('td');
            codeCell.textContent = item.code;
            
            const nameCell = document.createElement('td');
            nameCell.innerHTML = item.name.replace(/\n/g, '<br>');
            
            const qtyCell = document.createElement('td');
            qtyCell.textContent = item.qty;
            qtyCell.className = 'numeric';
            
            const reserveCell = document.createElement('td');
            reserveCell.textContent = item.reserve;
            reserveCell.className = 'numeric';
            
            const availableCell = document.createElement('td');
            availableCell.textContent = item.available;
            availableCell.className = 'numeric';
            if (item.available < 0) {
                availableCell.classList.add('stock-low');
            }
            
            const barcodeCell = document.createElement('td');
            barcodeCell.className = 'barcode-cell';
            
            // Check cache first
            const cachedBarcode = barcodeCache.get(item.code);
            
            if (cachedBarcode) {
                // Use cached barcode
                barcodeCell.innerHTML = cachedBarcode;
            } else {
                // Generate new barcode
                const barcodeContainer = document.createElement('div');
                barcodeContainer.className = 'barcode-container';
                
                const barcodeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                barcodeSvg.className = 'barcode';
                
                const barcodeText = document.createElement('div');
                barcodeText.className = 'barcode-text';
                barcodeText.textContent = item.code;
                
                JsBarcode(barcodeSvg, item.code, {
                    format: 'CODE128',
                    displayValue: false,
                    height: 40,
                    margin: 0,
                    background: 'transparent'
                });
                
                barcodeContainer.appendChild(barcodeSvg);
                barcodeContainer.appendChild(barcodeText);
                barcodeCell.appendChild(barcodeContainer);
                
                // Cache the generated barcode
                barcodeCache.set(item.code, barcodeContainer.outerHTML);
            }
            
            // Append cells to row
            row.appendChild(codeCell);
            row.appendChild(nameCell);
            row.appendChild(qtyCell);
            row.appendChild(reserveCell);
            row.appendChild(availableCell);
            row.appendChild(barcodeCell);
            
            // Append row to table
            stockTableBody.appendChild(row);
        });
        
        updateStatus();
    }

    // Highlight a specific item
    function highlightItem(code) {
        // Remove highlight from all rows
        document.querySelectorAll('#stockTableBody tr').forEach(row => {
            row.classList.remove('highlight');
        });
        
        // Add highlight to matching row
        const row = document.querySelector(`#stockTableBody tr[data-code="${code}"]`);
        if (row) {
            row.classList.add('highlight');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // Select a row
    function selectRow(row, item) {
        // Remove selection from all rows
        document.querySelectorAll('#stockTableBody tr').forEach(r => {
            r.classList.remove('selected');
        });
        
        // Add selection to clicked row
        row.classList.add('selected');
        selectedItem = item;
    }

    // Show print modal
    // Updated showPrintModal() function
function showPrintModal() {
    if (!selectedItem) {
        alert('Please select an item first by clicking on a row.');
        return;
    }
    
    // Create a clean first line of the item name (remove line breaks)
    const itemNameFirstLine = selectedItem.name.split('\n')[0];
    printBarcodeCode.textContent = selectedItem.code;
    
    // Update the modal content to show item name instead of "Product Barcode"
    const printBarcodeContainer = document.querySelector('.print-barcode-container');
    printBarcodeContainer.innerHTML = `
        <div style="margin-bottom: 10px;">
            <div style="font-weight: 500; font-size: 0.9rem;">${itemNameFirstLine}</div>
        </div>
        <div class="print-barcode-sticker">
            <svg id="printBarcode" width="200" height="60"></svg>
            <div class="print-barcode-code">${selectedItem.code}</div>
        </div>
    `;
    
    // Reinitialize the barcode SVG element
    const newPrintBarcode = printBarcodeContainer.querySelector('#printBarcode');
    JsBarcode(newPrintBarcode, selectedItem.code, {
        format: 'CODE128',
        displayValue: false,
        height: 50,
        margin: 0,
        background: 'transparent'
    });
    
    printModal.style.display = 'block';
}

// Updated printBarcode() function to include the name
function printBarcode() {
    const itemNameFirstLine = selectedItem.name.split('\n')[0];
    const printContent = `
        <div style="text-align: center; margin-bottom: 5px; font-size: 12px;">
            ${itemNameFirstLine}
        </div>
        <div class="print-barcode-sticker">
            <svg width="200" height="60">
                ${printBarcodeSvg.innerHTML}
            </svg>
            <div class="print-barcode-code">${printBarcodeCode.textContent}</div>
        </div>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Print Barcode</title>
            <style>
                @page {
                    size: 50mm 30mm;
                    margin: 0;
                }
                body {
                    margin: 0;
                    padding: 5px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    font-family: Arial, sans-serif;
                }
                .print-barcode-sticker {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                }
                .print-barcode-sticker svg {
                    width: 100%;
                    height: auto;
                }
                .print-barcode-code {
                    font-family: 'Courier New', monospace;
                    font-size: 10px;
                    text-align: center;
                    margin-top: 3px;
                }
            </style>
        </head>
        <body>
            ${printContent}
            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                        window.close();
                    }, 200);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

    // Toggle scanner
    function toggleScanner() {
        if (scannerActive) {
            stopScanner();
            scannerModal.style.display = 'none';
        } else {
            scannerModal.style.display = 'block';
            startScanner();
        }
    }

    // Start barcode scanner
    function startScanner() {
        scannerActive = true;
        scannerResult.style.display = 'none';
        
        navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        }).then(function(s) {
            stream = s;
            scannerVideo.srcObject = stream;
            scannerVideo.play();
            
            // Check for torch support
            if ('torch' in stream.getVideoTracks()[0].getSettings()) {
                toggleTorch.style.display = 'flex';
            }
            
            // Initialize QuaggaJS
            Quagga.init({
                inputStream: {
                    name: "Live",
                    type: "LiveStream",
                    target: scannerVideo,
                    constraints: {
                        width: 1280,
                        height: 720,
                        facingMode: "environment"
                    },
                },
                decoder: {
                    readers: ["code_128_reader"]
                },
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
            console.error("Error accessing camera: ", err);
            alert("Could not access the camera. Please check permissions.");
            scannerActive = false;
            scannerModal.style.display = 'none';
        });
    }

    // Stop barcode scanner
    function stopScanner() {
        scannerActive = false;
        Quagga.stop();
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        toggleTorch.style.display = 'none';
        torchOn = false;
    }

    // Toggle torch
    function toggleTorchFunction() {
        if (stream) {
            const track = stream.getVideoTracks()[0];
            if (track.getCapabilities().torch) {
                torchOn = !torchOn;
                track.applyConstraints({
                    advanced: [{torch: torchOn}]
                }).catch(e => console.error(e));
            }
        }
    }

    // Show scanner result
    function showScannerResult(code) {
        const item = stockData.find(item => item.code === code);
        
        if (item) {
            scannerCode.textContent = item.code;
            scannerName.textContent = item.name.split('\n')[0];
            scannerQty.textContent = item.qty;
            scannerReserve.textContent = item.reserve;
            
            // Highlight in table
            searchInput.value = code;
            filterItems();
            highlightItem(code);
            
            scannerResult.style.display = 'block';
        } else {
            alert('Product not found with code: ' + code);
            startScanner();
        }
    }

    // Update status bar
    function updateStatus() {
        itemCountSpan.textContent = `${filteredData.length} of ${stockData.length} items`;
        lastUpdatedSpan.textContent = `Last updated: ${new Date().toLocaleString()}`;
    }

    // Initialize with sample data if needed
    function initSampleData() {
        // This is just for testing if no Excel file is loaded
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

    // Clear expired barcode cache on startup
    barcodeCache.clearExpired();

    // Initialize with sample data (comment out in production)
    initSampleData();
});