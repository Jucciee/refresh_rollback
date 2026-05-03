chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['settings', 'savedStates'], (result) => {
    if (!result.settings) {
      chrome.storage.local.set({
        settings: {
          maxStates: 5,
          filterMode: 'blacklist', // 'whitelist' or 'blacklist'
          filterSites: [] // array of domains
        }
      });
    }
    if (!result.savedStates) {
      chrome.storage.local.set({ savedStates: {} });
    }
  });
});

// Clean up states when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(['savedStates'], (result) => {
    const states = result.savedStates || {};
    if (states[tabId]) {
      delete states[tabId];
      chrome.storage.local.set({ savedStates: states });
    }
  });
});

// Listen for keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'restore-state') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'trigger-restore' }).catch(() => {});
      }
    });
  }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'prepare-save') {
    console.log('Refresh Rollback Background: Received prepare-save request from tab', sender.tab?.id, sender.tab?.url);
    const tabId = sender.tab.id;
    const url = sender.tab.url;
    const origin = new URL(url).hostname;
    
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings || { filterMode: 'blacklist', filterSites: [] };
      const sites = settings.filterSites.map(s => s.toLowerCase());
      
      // Check if site is allowed
      let isAllowed = true;
      if (settings.filterMode === 'whitelist') {
        isAllowed = sites.some(s => origin.includes(s));
      } else if (settings.filterMode === 'blacklist') {
        isAllowed = !sites.some(s => origin.includes(s));
      }
      
      sendResponse({ isAllowed: isAllowed, tabId: tabId });
    });
    
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'get-latest-state') {
    const tabId = request.tabId || sender.tab.id;
    const index = request.stateIndex !== undefined ? request.stateIndex : 0;
    chrome.storage.local.get(['savedStates'], (result) => {
      const states = result.savedStates || {};
      const tabStates = states[tabId] || [];
      if (tabStates.length > index) {
        sendResponse({ state: tabStates[index] });
      } else {
        sendResponse({ state: null });
      }
    });
    return true;
  }
  
  if (request.action === 'open-in-new-tab') {
    const sourceTabId = request.tabId;
    const index = request.stateIndex;
    
    chrome.storage.local.get(['savedStates'], (result) => {
      const states = result.savedStates || {};
      const tabStates = states[sourceTabId] || [];
      const stateToOpen = tabStates[index];
      
      if (stateToOpen) {
        chrome.tabs.create({ url: stateToOpen.url, active: true }, (newTab) => {
          const newTabId = newTab.id;
          
          // Wait for the new tab to finish loading
          const listener = (tabId, changeInfo) => {
            if (tabId === newTabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              // Send the restore command directly
              chrome.tabs.sendMessage(newTabId, { 
                action: 'trigger-restore-direct', 
                stateData: stateToOpen.data 
              }).catch(() => {
                // If content script is slow to inject, retry once after a short delay
                setTimeout(() => {
                  chrome.tabs.sendMessage(newTabId, { action: 'trigger-restore-direct', stateData: stateToOpen.data }).catch(() => {});
                }, 500);
              });
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    });
    return true;
  }
});
