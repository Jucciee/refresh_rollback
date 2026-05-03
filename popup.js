document.addEventListener('DOMContentLoaded', () => {
  const stateList = document.getElementById('stateList');
  const optionsLink = document.getElementById('optionsLink');

  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Fetch and display actual shortcut
  chrome.commands.getAll((commands) => {
    const restoreCmd = commands.find(c => c.name === 'restore-state');
    const shortcutDisplay = document.getElementById('shortcutDisplay');
    if (shortcutDisplay) {
      if (restoreCmd && restoreCmd.shortcut) {
        shortcutDisplay.textContent = restoreCmd.shortcut;
      } else {
        shortcutDisplay.textContent = 'Not set';
      }
    }
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const currentTabId = tabs[0].id;

    chrome.storage.local.get(['savedStates'], (result) => {
      const states = result.savedStates || {};
      const tabStates = states[currentTabId] || [];

      stateList.innerHTML = '';

      if (tabStates.length === 0) {
        stateList.innerHTML = '<div class="empty-state">No saved states found. Press F5 to save one.</div>';
        return;
      }

      tabStates.forEach((state, index) => {
        const li = document.createElement('li');
        li.className = 'state-item';
        
        const date = new Date(state.timestamp);
        const timeString = date.toLocaleTimeString();
        
        let infoHtml = `Scroll Y: ${Math.round(state.data.scrollY)}`;
        if (state.data.youtubeMode) {
          infoHtml += `<span class="youtube-badge">YouTube Feed</span>`;
        }
        if (state.label) {
          infoHtml += `<span class="special-label">${state.label}</span>`;
        }

        li.innerHTML = `
          <div class="state-content">
            <div class="state-time">${timeString} ${index === 0 ? '(Latest)' : ''}</div>
            <div class="state-info">${infoHtml}</div>
          </div>
          <div class="state-actions">
            <button class="action-btn new-tab-btn">New Tab</button>
            <button class="action-btn delete-btn">Delete</button>
          </div>
        `;

        const contentDiv = li.querySelector('.state-content');
        const newTabBtn = li.querySelector('.new-tab-btn');
        const deleteBtn = li.querySelector('.delete-btn');

        contentDiv.addEventListener('click', () => {
          chrome.tabs.sendMessage(currentTabId, { action: 'trigger-restore', stateIndex: index });
          window.close(); // close popup
        });

        newTabBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'open-in-new-tab', tabId: currentTabId, stateIndex: index });
          window.close();
        });

        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          tabStates.splice(index, 1);
          states[currentTabId] = tabStates;
          chrome.storage.local.set({ savedStates: states }, () => {
             // reload popup to reflect deletion
             window.location.reload();
          });
        });

        stateList.appendChild(li);
      });
    });
  });
});
