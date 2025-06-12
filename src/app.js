class SQSDashboard {
    constructor() {
        this.queues = [];
        this.filteredQueues = [];
        this.refreshInterval = null;
        this.refreshIntervalTime = 5000; // 5 seconds
        this.hideEmptyQueues = false; // Track hide empty queues state
        
        this.initializeElements();
        this.bindEvents();
        this.initialize();
    }

    initializeElements() {
        this.elements = {
            refreshBtn: document.getElementById('refreshBtn'),
            searchInput: document.getElementById('searchInput'),
            connectionStatus: document.getElementById('connectionStatus'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusText: document.getElementById('statusText'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            queueGrid: document.getElementById('queueGrid'),
            errorModal: document.getElementById('errorModal'),
            errorMessage: document.getElementById('errorMessage'),
            errorModalClose: document.getElementById('errorModalClose'),
            errorModalOk: document.getElementById('errorModalOk'),
            regionSelect: document.getElementById('regionSelect'),
            hideEmptyQueues: document.getElementById('hideEmptyQueues'),
            
            // Stats
            totalQueues: document.getElementById('totalQueues'),
            totalMessages: document.getElementById('totalMessages'),
            hiddenMessages: document.getElementById('hiddenMessages'),
            delayedMessages: document.getElementById('delayedMessages')
        };
    }

    bindEvents() {
        this.elements.refreshBtn.addEventListener('click', () => this.loadQueues());
        this.elements.searchInput.addEventListener('input', (e) => this.filterQueues(e.target.value));
        this.elements.regionSelect.addEventListener('change', (e) => this.changeRegion(e.target.value));
        this.elements.hideEmptyQueues.addEventListener('change', (e) => this.toggleEmptyQueues(e.target.checked));
        
        // Error modal events
        this.elements.errorModalClose.addEventListener('click', () => this.hideErrorModal());
        this.elements.errorModalOk.addEventListener('click', () => this.hideErrorModal());
        this.elements.errorModal.addEventListener('click', (e) => {
            if (e.target === this.elements.errorModal) {
                this.hideErrorModal();
            }
        });
    }

    async initialize() {
        await this.loadPersistedRegion();
        this.loadPersistedEmptyQueueFilter();
        await this.checkConnection();
        await this.loadQueues();
        this.startAutoRefresh();
    }

    async checkConnection() {
        try {
            const result = await window.electronAPI.checkConnection();
            this.updateConnectionStatus(result.connected, result.error, result.region);
        } catch (error) {
            this.updateConnectionStatus(false, error.message);
        }
    }

    updateConnectionStatus(connected, error = null, region = null) {
        this.elements.statusIndicator.className = `status-indicator ${connected ? 'online' : 'offline'}`;
        const regionText = region ? ` (${region})` : '';
        this.elements.statusText.textContent = connected ? 
            `Connected to LocalStack${regionText}` : 
            `Disconnected${error ? `: ${error}` : ''}`;
    }

    async loadQueues() {
        this.showLoading();
        
        try {
            this.queues = await window.electronAPI.getQueues();
            this.filterQueues(this.elements.searchInput.value);
            this.updateStats();
            await this.checkConnection();
        } catch (error) {
            this.showError('Failed to load queues', error.message);
        } finally {
            this.hideLoading();
        }
    }

    filterQueues(searchTerm = '') {
        const term = searchTerm.toLowerCase();
        this.filteredQueues = this.queues.filter(queue => {
            // Search term filter
            const matchesSearch = queue.name.toLowerCase().includes(term);
            
            // Empty queue filter
            if (this.hideEmptyQueues) {
                const attributes = queue.attributes || {};
                const visibleMessages = parseInt(attributes.ApproximateNumberOfMessages || 0);
                const hiddenMessages = parseInt(attributes.ApproximateNumberOfMessagesNotVisible || 0);
                const delayedMessages = parseInt(attributes.ApproximateNumberOfMessagesDelayed || 0);
                const totalMessages = visibleMessages + hiddenMessages + delayedMessages;
                
                return matchesSearch && totalMessages > 0;
            }
            
            return matchesSearch;
        });
        this.renderQueues();
    }

    renderQueues() {
        if (this.filteredQueues.length === 0) {
            this.elements.queueGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <div class="empty-state-title">No queues found</div>
                    <div class="empty-state-message">
                        ${this.queues.length === 0 ? 'No SQS queues available in LocalStack' : 'No queues match your search criteria'}
                    </div>
                </div>
            `;
            return;
        }

        this.elements.queueGrid.innerHTML = this.filteredQueues.map(queue => this.renderQueueCard(queue)).join('');
        this.bindQueueEvents();
    }

    renderQueueCard(queue) {
        const attributes = queue.attributes || {};
        const visibleMessages = parseInt(attributes.ApproximateNumberOfMessages || 0);
        const hiddenMessages = parseInt(attributes.ApproximateNumberOfMessagesNotVisible || 0);
        const delayedMessages = parseInt(attributes.ApproximateNumberOfMessagesDelayed || 0);
        const totalMessages = visibleMessages + hiddenMessages + delayedMessages;
        
        const visibilityTimeout = attributes.VisibilityTimeout ? `${attributes.VisibilityTimeout}s` : 'N/A';
        const retentionPeriod = attributes.MessageRetentionPeriod ? 
            this.formatDuration(parseInt(attributes.MessageRetentionPeriod)) : 'N/A';

        return `
            <div class="queue-card" data-queue-url="${queue.url}">
                <div class="queue-header">
                    <div class="queue-name">${queue.name}</div>
                    <div class="queue-actions">
                        <button class="btn btn-danger btn-small purge-btn" 
                                data-queue-url="${queue.url}"
                                ${totalMessages === 0 ? 'disabled' : ''}>
                            <span class="btn-icon">🗑️</span>
                            Purge
                        </button>
                        <button class="btn btn-danger btn-small delete-btn" 
                                data-queue-url="${queue.url}">
                            <span class="btn-icon">❌</span>
                            Delete
                        </button>
                    </div>
                </div>
                
                <div class="queue-metrics">
                    <div class="metric visible">
                        <div class="metric-value">${visibleMessages}</div>
                        <div class="metric-label">Visible</div>
                    </div>
                    <div class="metric hidden">
                        <div class="metric-value">${hiddenMessages}</div>
                        <div class="metric-label">Hidden</div>
                    </div>
                    <div class="metric delayed">
                        <div class="metric-value">${delayedMessages}</div>
                        <div class="metric-label">Delayed</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${totalMessages}</div>
                        <div class="metric-label">Total</div>
                    </div>
                </div>
                
                <div class="queue-meta">
                    <div>
                        <strong>Visibility Timeout:</strong> ${visibilityTimeout} | 
                        <strong>Retention:</strong> ${retentionPeriod}
                    </div>
                    <div>
                        Last updated: ${new Date(queue.lastUpdated).toLocaleTimeString()}
                    </div>
                </div>
                
                ${queue.error ? `
                    <div class="queue-error">
                        <strong>Error:</strong> ${queue.error}
                    </div>
                ` : ''}
            </div>
        `;
    }

    bindQueueEvents() {
        document.querySelectorAll('.purge-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const queueUrl = btn.dataset.queueUrl;
                await this.purgeQueue(queueUrl);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const queueUrl = btn.dataset.queueUrl;
                await this.deleteQueue(queueUrl);
            });
        });
    }

    async purgeQueue(queueUrl) {
        try {
            const result = await window.electronAPI.purgeQueue(queueUrl);
            
            if (result.success) {
                // Refresh the queues after successful purge
                await this.loadQueues();
            } else {
                if (result.message !== 'Purge cancelled') {
                    this.showError('Purge Failed', result.message);
                }
            }
        } catch (error) {
            this.showError('Purge Failed', error.message);
        }
    }

    async deleteQueue(queueUrl) {
        try {
            const result = await window.electronAPI.deleteQueue(queueUrl);
            
            if (result.success) {
                // Refresh the queues after successful deletion
                await this.loadQueues();
            } else {
                if (result.message !== 'Deletion cancelled') {
                    this.showError('Delete Failed', result.message);
                }
            }
        } catch (error) {
            this.showError('Delete Failed', error.message);
        }
    }

    async loadPersistedRegion() {
        try {
            // Load persisted region from localStorage
            const savedRegion = localStorage.getItem('sqs-dashboard-region');
            if (savedRegion) {
                // Set the dropdown to the saved region
                this.elements.regionSelect.value = savedRegion;
                // Change to the saved region
                await this.changeRegion(savedRegion, false); // false = don't save again
            } else {
                // Load current region from backend
                const result = await window.electronAPI.getCurrentRegion();
                this.elements.regionSelect.value = result.region;
            }
        } catch (error) {
            console.error('Failed to load persisted region:', error);
        }
    }

    async changeRegion(newRegion, persist = true) {
        try {
            this.showLoading();
            
            const result = await window.electronAPI.changeRegion(newRegion);
            
            if (result.success) {
                // Persist the region selection
                if (persist) {
                    localStorage.setItem('sqs-dashboard-region', newRegion);
                }
                
                // Update the UI
                this.elements.regionSelect.value = newRegion;
                
                // Refresh connection status and queues
                await this.checkConnection();
                await this.loadQueues();
            } else {
                this.showError('Region Change Failed', result.error);
            }
        } catch (error) {
            this.showError('Region Change Failed', error.message);
        } finally {
            this.hideLoading();
        }
    }

    loadPersistedEmptyQueueFilter() {
        try {
            const savedFilter = localStorage.getItem('sqs-dashboard-hide-empty');
            if (savedFilter !== null) {
                this.hideEmptyQueues = savedFilter === 'true';
                this.elements.hideEmptyQueues.checked = this.hideEmptyQueues;
            }
        } catch (error) {
            console.error('Failed to load persisted empty queue filter:', error);
        }
    }

    toggleEmptyQueues(hide) {
        this.hideEmptyQueues = hide;
        
        // Persist the preference
        try {
            localStorage.setItem('sqs-dashboard-hide-empty', hide.toString());
        } catch (error) {
            console.error('Failed to persist empty queue filter:', error);
        }
        
        // Reapply filters
        this.filterQueues(this.elements.searchInput.value);
        this.updateStats();
    }

    updateStats() {
        // Calculate stats for visible queues (after filtering)
        let visibleQueues = this.filteredQueues.length;
        let totalQueues = this.queues.length;
        let totalMessages = 0;
        let totalHidden = 0;
        let totalDelayed = 0;

        this.filteredQueues.forEach(queue => {
            const attributes = queue.attributes || {};
            totalMessages += parseInt(attributes.ApproximateNumberOfMessages || 0);
            totalHidden += parseInt(attributes.ApproximateNumberOfMessagesNotVisible || 0);
            totalDelayed += parseInt(attributes.ApproximateNumberOfMessagesDelayed || 0);
        });

        // Show filtered vs total queues if different
        const queueDisplay = visibleQueues === totalQueues ? 
            totalQueues : 
            `${visibleQueues}/${totalQueues}`;

        this.elements.totalQueues.textContent = queueDisplay;
        this.elements.totalMessages.textContent = totalMessages;
        this.elements.hiddenMessages.textContent = totalHidden;
        this.elements.delayedMessages.textContent = totalDelayed;
    }

    formatDuration(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.loadQueues();
        }, this.refreshIntervalTime);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    showLoading() {
        this.elements.loadingOverlay.style.display = 'flex';
    }

    hideLoading() {
        this.elements.loadingOverlay.style.display = 'none';
    }

    showError(title, message) {
        this.elements.errorMessage.innerHTML = `<strong>${title}</strong><br><br>${message}`;
        this.elements.errorModal.style.display = 'flex';
    }

    hideErrorModal() {
        this.elements.errorModal.style.display = 'none';
    }
}

// Initialize the dashboard when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SQSDashboard();
});

// Handle window lifecycle
window.addEventListener('beforeunload', () => {
    if (window.dashboard) {
        window.dashboard.stopAutoRefresh();
    }
});