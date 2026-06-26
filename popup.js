const keyStatus = document.getElementById('key-status');
const intentBadge = document.getElementById('intent-badge');

// Check API key + current intent
chrome.storage.local.get(['openaiApiKey', 'analysisIntent'], result => {
  if (result.openaiApiKey) {
    keyStatus.textContent = '✓ API key configured';
    keyStatus.className = 'key-status key-ok';
  } else {
    keyStatus.textContent = '⚠ No API key — add one in Settings to get started';
    keyStatus.className = 'key-status key-missing';
  }

  const intent = result.analysisIntent || 'b2b_sales';
  intentBadge.textContent = intent === 'job_search' ? '🎯 Job Search mode' : intent === 'b2c_sales' ? '🧑‍💻 Freelance mode' : '💼 B2B Sales mode';
  intentBadge.className = 'intent-badge';
});

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
