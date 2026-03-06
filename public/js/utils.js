// ==================== UTILITY FUNCTIONS ====================

// Show alert messages
function showAlert(message, type = 'success') {
  const alertDiv = document.getElementById('alert');
  if (alertDiv) {
    alertDiv.textContent = message;
    alertDiv.className = `alert alert-${type} show`;
    setTimeout(() => {
      alertDiv.classList.remove('show');
    }, 5000);
  }
}

// Hide alert
function hideAlert() {
  const alertDiv = document.getElementById('alert');
  if (alertDiv) {
    alertDiv.classList.remove('show');
  }
}

// API call helper
async function apiCall(method, url, data = null) {
  try {
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'An error occurred');
    }

    return result;
  } catch (error) {
    showAlert(error.message, 'error');
    throw error;
  }
}

// Form data helper for file uploads
async function apiCallWithFile(method, url, formData) {
  try {
    const options = {
      method: method
    };

    if (formData instanceof FormData) {
      options.body = formData;
    } else {
      options.body = formData;
    }

    const response = await fetch(url, options);
    
    // Check if response is ok before parsing JSON
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorMessage = 'An error occurred';
      
      if (contentType && contentType.includes('application/json')) {
        try {
          const result = await response.json();
          errorMessage = result.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error: ${response.status}`;
        }
      } else {
        errorMessage = `Server error: ${response.status} ${response.statusText}`;
      }
      
      throw new Error(errorMessage);
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    showAlert(error.message, 'error');
    throw error;
  }
}

// Validate email
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Validate phone number (10 digits)
function validatePhone(phone) {
  const re = /^\d{10}$/;
  return re.test(phone.replace(/\D/g, ''));
}

// Format date
function formatDate(dateString) {
  const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Date(dateString).toLocaleDateString('en-US', options);
}

// Get query parameter from URL
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// Check if user is logged in
async function checkUserSession() {
  try {
    const response = await fetch('/dashboard');
    if (response.status === 401) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Check if admin is logged in
async function checkAdminSession() {
  try {
    const response = await fetch('/admin/dashboard');
    if (response.status === 401) {
      window.location.href = '/admin-login.html';
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Logout function
async function logout() {
  try {
    const result = await apiCall('GET', '/logout');
    if (result.success) {
      window.location.href = result.redirect;
    }
  } catch (error) {
    console.error('Logout error:', error);
  }
}

// Admin logout function
async function adminLogout() {
  try {
    const result = await apiCall('GET', '/admin/logout');
    if (result.success) {
      window.location.href = result.redirect;
    }
  } catch (error) {
    console.error('Logout error:', error);
  }
}

// Show loading spinner
function showLoading() {
  const loading = document.querySelector('.loading');
  if (loading) {
    loading.classList.add('show');
  }
}

// Hide loading spinner
function hideLoading() {
  const loading = document.querySelector('.loading');
  if (loading) {
    loading.classList.remove('show');
  }
}

// Render complaints list
function renderComplaintsList(complaints) {
  const container = document.getElementById('complaints-list');
  if (!container) return;

  if (complaints.length === 0) {
    container.innerHTML = '<p class="text-center text-muted">No complaints filed yet.</p>';
    return;
  }

  container.innerHTML = complaints.map(complaint => `
    <div class="card">
      <div class="card-title">Department: ${complaint.department}</div>
      <span class="card-badge badge-${complaint.status.toLowerCase().replace(' ', '-')}">${complaint.status}</span>
      <p class="card-text"><strong>Location:</strong> ${complaint.location}</p>
      <p class="card-text"><strong>Description:</strong> ${complaint.complaint_text.substring(0, 100)}...</p>
      <p class="card-text text-muted"><strong>Date:</strong> ${formatDate(complaint.created_at)}</p>
      <div style="display: flex; gap: 10px;">
        <button class="btn btn-info btn-small" onclick="viewMessages(${complaint.id})">View Messages</button>
        <button class="btn btn-secondary btn-small" onclick="viewProof('/image/complaint-proof/${complaint.id}')">View Proof</button>
      </div>
    </div>
  `).join('');
}

// View proof image
function viewProof(imageUrl) {
  console.log('[viewProof] Opening image modal with URL:', imageUrl);
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    cursor: pointer;
  `;

  const img = document.createElement('img');
  img.src = imageUrl;
  img.onerror = function() {
    console.error('[viewProof] Failed to load image from:', imageUrl);
    document.body.removeChild(modal);
    alert('Failed to load image. The image may not exist or the URL is invalid.');
  };
  img.onload = function() {
    console.log('[viewProof] Image loaded successfully from:', imageUrl);
  };
  img.style.cssText = `
    max-width: 90%;
    max-height: 90%;
    border-radius: 10px;
    box-shadow: 0 5px 20px rgba(0,0,0,0.3);
  `;

  modal.appendChild(img);
  modal.onclick = () => document.body.removeChild(modal);
  document.body.appendChild(modal);
}

// View messages
function viewMessages(complaintId) {
  window.location.href = `/complaint-messages.html?id=${complaintId}`;
}

// Truncate text
function truncateText(text, length = 100) {
  if (text.length > length) {
    return text.substring(0, length) + '...';
  }
  return text;
}

// ==================== DARK MODE ==================== 
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    updateThemeButton();
  }
}

function toggleTheme() {
  const isDarkMode = document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  updateThemeButton();
}

function updateThemeButton() {
  const isDark = document.body.classList.contains('dark-mode');
  const buttons = document.querySelectorAll('.theme-toggle');
  buttons.forEach(btn => {
    btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
  });
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', initTheme);

