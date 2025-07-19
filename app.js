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
    const printQRContainer = document.getElementById('printQRContainer');
    const printQRCode = document.getElementById('printQRCode');
    
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

    // QR Code Cache Manager
    const qrCodeCache = {
        get: function(code) {
            const cached = localStorage.getItem(`qrcode_${code}`);
            return cached ? cached : null;
        },
        set: function(code, svg) {
            const entry = {
                svg: svg,
                timestamp: Date.now()
            };
            localStorage.setItem(`qrcode_${code}`, JSON.stringify(entry));
        },
        clear: function() {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('qrcode_')) {
                    localStorage.removeItem(key);
                }
            });
        },
        clearExpired: function(maxAgeDays = 30) {
            const now = Date.now();
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('qrcode_')) {
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
    printBtn.addEventListener('click', printQRCode);
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
        qrCodeCache.clear();
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

    // Enhanced search functionality
    function filterItems() {
        const searchTerm = searchInput.value.trim();
        
        if (!searchTerm) {
            filteredData = [...stockData];
        } else {
            // Escape special regex characters except %
            const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Replace % with .* for wildcard matching
            const regexPattern = escapedTerm.replace(/%/g, '.*');
            const regex = new RegExp(regexPattern, 'i');
            
            filteredData = stockData.filter(item => 
                regex.test(item.code) || regex.test(item.name)
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
            
            // Create cells with data-label attributes
            const codeCell = document.createElement('td');
            codeCell.textContent = item.code;
            codeCell.setAttribute('data-label', 'Code');
            
            const nameCell = document.createElement('td');
            nameCell.innerHTML = item.name.replace(/\n/g, '<br>');
            nameCell.setAttribute('data-label', 'Name');
            
            const qtyCell = document.createElement('td');
            qtyCell.textContent = item.qty;
            qtyCell.className = 'numeric';
            qtyCell.setAttribute('data-label', 'QTY');
            
            const reserveCell = document.createElement('td');
            reserveCell.textContent = item.reserve;
            reserveCell.className = 'numeric';
            reserveCell.setAttribute('data-label', 'Reserve');
            
            const availableCell = document.createElement('td');
            availableCell.textContent = item.available;
            availableCell.className = 'numeric';
            availableCell.setAttribute('data-label', 'Available');
            if (item.available < 0) {
                availableCell.classList.add('stock-low');
            }
            
            const qrCodeCell = document.createElement('td');
            qrCodeCell.className = 'qrcode-cell';
            qrCodeCell.setAttribute('data-label', 'QR Code');
            
            // Check cache first
            const cachedQRCode = qrCodeCache.get(item.code);
            
            if (cachedQRCode) {
                // Use cached QR code
                qrCodeCell.innerHTML = JSON.parse(cachedQRCode).svg;
            } else {
                // Generate new QR code
                const qrCodeContainer = document.createElement('div');
                qrCodeContainer.className = 'qrcode-container';
                
                const qrCodeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                qrCodeSvg.className = 'qrcode';
                qrCodeSvg.setAttribute('width', '100');
                qrCodeSvg.setAttribute('height', '100');
                
                // Generate QR code using qrcode-generator library
                const qr = qrcode(0, 'L');
                qr.addData(item.code);
                qr.make();
                
                const qrCodeHtml = qr.createSvgTag(2, 0);
                qrCodeSvg.innerHTML = qrCodeHtml;
                
                qrCodeContainer.appendChild(qrCodeSvg);
                qrCodeCell.appendChild(qrCodeContainer);
                
                // Cache the generated QR code
                qrCodeCache.set(item.code, qrCodeContainer.outerHTML);
            }
            
            // Append cells to row
            row.appendChild(codeCell);
            row.appendChild(nameCell);
            row.appendChild(qtyCell);
            row.appendChild(reserveCell);
            row.appendChild(availableCell);
            row.appendChild(qrCodeCell);
            
            // Append row to table
            stockTableBody.appendChild(row);
        });
        
        // Add responsive class to table container if mobile
        const tableContainer = document.querySelector('.table-container');
        if (window.innerWidth < 640) {
            tableContainer.classList.add('mobile-view');
        } else {
            tableContainer.classList.remove('mobile-view');
        }
        
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
    function showPrintModal() {
        if (!selectedItem) {
            alert('Please select an item first by clicking on a row.');
            return;
        }
        
        const itemNameFirstLine = selectedItem.name.split('\n')[0].substring(0, 20);
        printQRCode.textContent = selectedItem.code;
        
        // Generate QR code for printing
        const qr = qrcode(0, 'L');
        qr.addData(selectedItem.code);
        qr.make();
        const qrCodeSvg = qr.createSvgTag(4, 0);
        
        printQRContainer.innerHTML = `
            <div class="print-qrcode-label">${itemNameFirstLine}</div>
            <div class="print-qrcode-sticker">
                ${qrCodeSvg}
                <div class="print-qrcode-code">${selectedItem.code}</div>
            </div>
        `;
        
        printModal.style.display = 'block';
    }

    // Print QR code
    function printQRCode() {
        const itemNameFirstLine = selectedItem.name.split('\n')[0].substring(0, 20);
        
        // Generate fresh QR code for printing
        const qr = qrcode(0, 'L');
        qr.addData(selectedItem.code);
        qr.make();
        const qrCodeSvg = qr.createSvgTag(4, 0);
        
        const printContent = `
            <div class="sticker-container">
                <div class="sticker-name">${itemNameFirstLine}</div>
                <div class="sticker-qrcode">${qrCodeSvg}</div>
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
                    @page {
                        size: 40mm 23mm;
                        margin: 0;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        width: 40mm;
                        height: 23mm;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        font-family: Arial, sans-serif;
                    }
                    .sticker-container {
                        text-align: center;
                        width: 100%;
                        padding: 1mm;
                        box-sizing: border-box;
                    }
                    .sticker-name {
                        font-size: 8px;
                        font-weight: bold;
                        margin-bottom: 1mm;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .sticker-qrcode svg {
                        width: 20mm !important;
                        height: 20mm !important;
                    }
                    .sticker-code {
                        font-size: 7px;
                        font-family: 'Courier New', monospace;
                        margin-top: 0.5mm;
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
                        }, 100);
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

    // Clear expired QR code cache on startup
    qrCodeCache.clearExpired();

    // Initialize with sample data (comment out in production)
    initSampleData();
});
