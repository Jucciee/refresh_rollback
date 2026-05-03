// Utility to capture state
function captureState() {
  const state = {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    inputs: [],
    customDOM: null,
    youtubeMode: false
  };

  // Capture input values
  const inputs = document.querySelectorAll('input:not([type="password"]), textarea');
  inputs.forEach((input, index) => {
    // Generate a simple selector path to find it again
    state.inputs.push({
      index: index,
      value: input.value,
      type: input.type,
      id: input.id,
      name: input.name
    });
  });

  // Specifically check for YouTube Feed
  if (window.location.hostname.includes('youtube.com')) {
    const youtubeFeed = document.querySelector('ytd-rich-grid-renderer');
    if (youtubeFeed) {
      state.youtubeMode = true;
      state.customDOM = youtubeFeed.innerHTML;
      console.log('Refresh Rollback: Captured YouTube feed state.');
    }
  } else {
    // For all other sites, capture the body HTML
    state.youtubeMode = false;
    state.customDOM = document.body.innerHTML;
  }

  return state;
}

// Utility to restore state
function restoreState(stateData, attempts = 0) {
  if (!stateData) return;

  // Restore DOM first
  if (stateData.youtubeMode && stateData.customDOM) {
    const youtubeFeed = document.querySelector('ytd-rich-grid-renderer');
    if (youtubeFeed) {
      youtubeFeed.innerHTML = stateData.customDOM;
      console.log('Refresh Rollback: Restored YouTube feed state.');
    } else if (attempts < 20) {
      setTimeout(() => restoreState(stateData, attempts + 1), 500);
      return; // Wait for retry
    } else {
      console.warn('Refresh Rollback: Could not find YouTube feed container to restore to.');
    }
  } else if (!stateData.youtubeMode && stateData.customDOM) {
    if (document.body) {
      document.body.innerHTML = stateData.customDOM;
      console.log('Refresh Rollback: Restored general DOM state.');
    } else if (attempts < 20) {
      setTimeout(() => restoreState(stateData, attempts + 1), 500);
      return; // Wait for retry
    }
  }

  // Restore scroll
  window.scrollTo({
    left: stateData.scrollX,
    top: stateData.scrollY,
    behavior: 'instant'
  });

  // Restore inputs
  const inputs = document.querySelectorAll('input:not([type="password"]), textarea');
  stateData.inputs.forEach((savedInput) => {
    // Try to match by id or name first, fallback to index
    let target = null;
    if (savedInput.id) {
      target = document.getElementById(savedInput.id);
    } else if (savedInput.name) {
      target = document.querySelector(`[name="${savedInput.name}"]`);
    } else if (inputs[savedInput.index]) {
      target = inputs[savedInput.index];
    }

    if (target && target.value !== undefined) {
      target.value = savedInput.value;
      // Dispatch events to trigger any React/framework listeners
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

// Global cached tab information to avoid relying on sleeping service worker during F5
let currentTabId = null;
let currentIsAllowed = true; // Assume true until we know otherwise

function initTabInfo() {
  chrome.runtime.sendMessage({ action: 'prepare-save' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      // Service worker might be waking up, retry in 200ms
      setTimeout(initTabInfo, 200);
    } else {
      currentTabId = response.tabId;
      currentIsAllowed = response.isAllowed;
    }
  });
}

// Initialize tab info immediately
initTabInfo();

// Intercept F5
window.addEventListener('keydown', (e) => {
  // Check for F5 or Ctrl+R / Cmd+R
  const isF5 = e.key === 'F5';
  const isCtrlR = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r';
  
  if (isF5 || isCtrlR) {
    // Prevent default immediately so we have time to save
    e.preventDefault();
    console.log(`Refresh Rollback Content: Intercepted refresh key (${e.key})`);
    
    try {
      const state = captureState();
      // Only stringify for logging if it's not insanely huge to avoid freezing, but length is useful
      console.log('Refresh Rollback Content: Captured state (youtubeMode:', state.youtubeMode, ')');
      
      if (!currentIsAllowed) {
        console.log('Refresh Rollback Content: Site is filtered, not saving state.');
        window.location.reload();
        return;
      }

      // If we somehow still don't have tabId, we can't save. Just reload.
      if (currentTabId === null) {
        console.warn('Refresh Rollback Content: Service worker never woke up to provide tabId. Bailing out.');
        window.location.reload();
        return;
      }

      const url = window.location.href;

      // Step 2: Save directly to chrome.storage.local to bypass sendMessage limits
      chrome.storage.local.get(['settings', 'savedStates'], (result) => {
        const settings = result.settings || { maxStates: 5 };
        let states = result.savedStates || {};
        
        if (!states[currentTabId]) {
          states[currentTabId] = [];
        }
        
        states[currentTabId].unshift({
          timestamp: Date.now(),
          url: url,
          data: state
        });
        
        if (states[currentTabId].length > settings.maxStates) {
          states[currentTabId] = states[currentTabId].slice(0, settings.maxStates);
        }
        
        chrome.storage.local.set({ savedStates: states }, () => {
          if (chrome.runtime.lastError) {
            console.error('Refresh Rollback Content: Error saving to storage (might be too large!):', chrome.runtime.lastError);
          } else {
            console.log('Refresh Rollback Content: Successfully saved state directly to storage for tab', currentTabId);
          }
          // Finally reload the page
          window.location.reload();
        });
      });
    } catch (err) {
      console.error('Refresh Rollback Content: Error during captureState/save:', err);
      window.location.reload();
    }
  }
}, { capture: true });

// Listen for restore commands from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'trigger-restore') {
    chrome.runtime.sendMessage({ action: 'get-latest-state', stateIndex: request.stateIndex }, (response) => {
      if (response && response.state) {
        // If we are already restoring a "돌아가기 전 State", do not create another one
        if (response.state.label === '돌아가기 전 State') {
          chrome.runtime.sendMessage({ action: 'prepare-save' }, (prepResponse) => {
            if (prepResponse && prepResponse.isAllowed) {
              const tabId = prepResponse.tabId;
              chrome.storage.local.get(['savedStates'], (result) => {
                let states = result.savedStates || {};
                if (states[tabId]) {
                  // Delete the "돌아가기 전 State" from the list since we are reverting to it
                  states[tabId] = states[tabId].filter(s => s.label !== '돌아가기 전 State');
                  chrome.storage.local.set({ savedStates: states }, () => {
                    restoreState(response.state.data);
                  });
                } else {
                  restoreState(response.state.data);
                }
              });
            } else {
              restoreState(response.state.data);
            }
          });
          return;
        }

        // Save current state before restoring
        const currentState = captureState();
        chrome.runtime.sendMessage({ action: 'prepare-save' }, (prepResponse) => {
          if (prepResponse && prepResponse.isAllowed) {
            const tabId = prepResponse.tabId;
            const url = window.location.href;
            
            chrome.storage.local.get(['settings', 'savedStates'], (result) => {
              const settings = result.settings || { maxStates: 5 };
              let states = result.savedStates || {};
              if (!states[tabId]) states[tabId] = [];
              
              // Remove any existing "돌아가기 전 State" so there is only ever one at a time
              states[tabId] = states[tabId].filter(s => s.label !== '돌아가기 전 State');
              
              states[tabId].unshift({
                timestamp: Date.now(),
                url: url,
                data: currentState,
                label: '돌아가기 전 State'
              });
              
              if (states[tabId].length > settings.maxStates) {
                states[tabId] = states[tabId].slice(0, settings.maxStates);
              }
              
              chrome.storage.local.set({ savedStates: states }, () => {
                restoreState(response.state.data);
              });
            });
          } else {
            restoreState(response.state.data);
          }
        });
      } else {
        alert('Refresh Rollback: No saved state found for this tab at the specified index.');
      }
    });
  }
});

// Check for pending restore on load (for new tabs)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'trigger-restore-direct') {
    console.log('Refresh Rollback Content: Received direct restore command (for new tab).');
    restoreState(request.stateData);
  }
});
