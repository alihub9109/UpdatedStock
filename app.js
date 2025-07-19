// ... (keep all your previous DOM element declarations and variable declarations)

    // Show scanner result - UPDATED TO PROPERLY DISPLAY ITEM INFO
    function showScannerResult(code) {
        // Clean the code by removing any whitespace or special characters
        const cleanCode = code.trim().toUpperCase();
        
        // Find the item (case-insensitive search)
        const item = stockData.find(item => 
            item.code.trim().toUpperCase() === cleanCode
        );

        if (item) {
            // Update scanner result display
            scannerCode.textContent = item.code;
            scannerName.textContent = item.name;
            scannerQty.textContent = item.qty;
            scannerReserve.textContent = item.reserve;

            // Highlight in table
            searchInput.value = item.code;
            filterItems();
            highlightItem(item.code);

            // Show the result modal
            scannerResult.style.display = 'block';
            
            // Stop the scanner
            stopScanner();
        } else {
            alert(`Product with code "${code}" not found in inventory.`);
            // Restart the scanner
            if (!scannerActive) {
                startScanner();
            }
        }
    }

    // Update your QR code generation to ensure proper encoding
    function createQRCodeCell(code) {
        const cell = document.createElement('td');
        cell.className = 'qrcode-cell';
        cell.setAttribute('data-label', 'QR Code');

        // Generate QR code with proper encoding
        const qr = qrcode(0, 'M'); // Medium error correction
        qr.addData(code); // Encode just the raw code without extra formatting
        qr.make();
        
        const container = document.createElement('div');
        container.className = 'qrcode-container';
        container.innerHTML = qr.createSvgTag(2, 0);
        
        cell.appendChild(container);
        return cell;
    }

    // Update your Quagga initialization to ensure proper scanning
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

            // Initialize Quagga with proper settings for QR codes
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
                    readers: [
                        "code_128_reader",
                        "ean_reader",
                        "ean_8_reader",
                        "code_39_reader",
                        "code_39_vin_reader",
                        "codabar_reader",
                        "upc_reader",
                        "upc_e_reader",
                        "qrcode_reader" // Make sure QR code reader is included
                    ],
                    debug: {
                        showCanvas: true,
                        showPatches: true,
                        showFoundPatches: true,
                        showSkeleton: true,
                        showLabels: true,
                        showPatchLabels: true,
                        showRemainingPatchLabels: true,
                        boxFromPatches: {
                            showTransformed: true,
                            showTransformedBox: true,
                            showBB: true
                        }
                    }
                },
                locate: true,
                numOfWorkers: 4
            }, function(err) {
                if (err) {
                    console.error(err);
                    return;
                }
                Quagga.start();
            });

            Quagga.onDetected(function(result) {
                const code = result.codeResult.code;
                showScannerResult(code);
            });
        }).catch(function(err) {
            console.error("Camera error:", err);
            alert("Could not access the camera. Please check permissions.");
            scannerActive = false;
            scannerModal.style.display = 'none';
        });
    }

// ... (keep the rest of your existing code)