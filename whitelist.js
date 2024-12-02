document.addEventListener('DOMContentLoaded', function() {
    const domainInput = document.getElementById('domainInput');
    const addButton = document.getElementById('addDomain');
    const whitelistContainer = document.getElementById('whitelistContainer');
    const emptyMessage = document.getElementById('emptyMessage');
    
    // تحميل القائمة البيضاء
    loadWhitelist();
    
    // إضافة نطاق جديد
    addButton.addEventListener('click', addDomain);
    domainInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addDomain();
        }
    });
    
    function addDomain() {
        const domain = domainInput.value.trim().toLowerCase();
        
        if (!domain) {
            alert('الرجاء إدخال نطاق صحيح');
            return;
        }
        
        // التحقق من صحة النطاق
        if (!isValidDomain(domain)) {
            alert('الرجاء إدخال نطاق صحيح (مثال: example.com)');
            return;
        }
        
        chrome.storage.sync.get(['whitelist'], function(result) {
            const whitelist = result.whitelist || [];
            
            if (whitelist.includes(domain)) {
                alert('هذا النطاق موجود بالفعل في القائمة البيضاء');
                return;
            }
            
            whitelist.push(domain);
            chrome.storage.sync.set({ whitelist: whitelist }, function() {
                createWhitelistItem(domain);
                domainInput.value = '';
                updateEmptyMessage();
            });
        });
    }
    
    function loadWhitelist() {
        chrome.storage.sync.get(['whitelist'], function(result) {
            const whitelist = result.whitelist || [];
            whitelistContainer.innerHTML = ''; // مسح القائمة الحالية
            
            whitelist.forEach(domain => {
                createWhitelistItem(domain);
            });
            
            updateEmptyMessage();
        });
    }
    
    function createWhitelistItem(domain) {
        const item = document.createElement('div');
        item.className = 'whitelist-item';
        
        const domainText = document.createElement('span');
        domainText.className = 'domain';
        domainText.textContent = domain;
        
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-btn';
        removeButton.textContent = 'إزالة';
        removeButton.onclick = function() {
            removeDomain(domain, item);
        };
        
        item.appendChild(domainText);
        item.appendChild(removeButton);
        whitelistContainer.appendChild(item);
    }
    
    function removeDomain(domain, item) {
        chrome.storage.sync.get(['whitelist'], function(result) {
            let whitelist = result.whitelist || [];
            whitelist = whitelist.filter(d => d !== domain);
            
            chrome.storage.sync.set({ whitelist: whitelist }, function() {
                item.remove();
                updateEmptyMessage();
            });
        });
    }
    
    function updateEmptyMessage() {
        const hasItems = whitelistContainer.querySelector('.whitelist-item');
        emptyMessage.style.display = hasItems ? 'none' : 'block';
    }
    
    function isValidDomain(domain) {
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
        return domainRegex.test(domain);
    }
});
