const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { SQSClient, ListQueuesCommand, GetQueueAttributesCommand, PurgeQueueCommand, GetQueueUrlCommand, DeleteQueueCommand } = require('@aws-sdk/client-sqs');

let mainWindow;
let sqsClient;

// LocalStack SQS configuration
let currentRegion = 'us-west-2'; // Default region

function getLocalStackConfig(region = currentRegion) {
  return {
    region: region,
    endpoint: 'http://localhost:4566',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test'
    }
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  initializeSQSClient();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function initializeSQSClient(region = currentRegion) {
  currentRegion = region;
  sqsClient = new SQSClient(getLocalStackConfig(region));
}

// IPC handlers
ipcMain.handle('get-queues', async () => {
  try {
    const command = new ListQueuesCommand({});
    const response = await sqsClient.send(command);
    
    if (!response.QueueUrls) {
      return [];
    }

    const queuesWithAttributes = await Promise.all(
      response.QueueUrls.map(async (queueUrl) => {
        try {
          const attributesCommand = new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
              'ApproximateNumberOfMessagesDelayed',
              'VisibilityTimeout',
              'MessageRetentionPeriod',
              'CreatedTimestamp'
            ]
          });
          
          const attributesResponse = await sqsClient.send(attributesCommand);
          const queueName = queueUrl.split('/').pop();
          
          return {
            name: queueName,
            url: queueUrl,
            attributes: attributesResponse.Attributes || {},
            lastUpdated: new Date().toISOString()
          };
        } catch (error) {
          console.error(`Error getting attributes for queue ${queueUrl}:`, error);
          return {
            name: queueUrl.split('/').pop(),
            url: queueUrl,
            attributes: {},
            error: error.message,
            lastUpdated: new Date().toISOString()
          };
        }
      })
    );

    return queuesWithAttributes;
  } catch (error) {
    console.error('Error fetching queues:', error);
    throw error;
  }
});

ipcMain.handle('purge-queue', async (event, queueUrl) => {
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Purge Queue'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Queue Purge',
      message: 'Are you sure you want to purge all messages from this queue?',
      detail: `Queue: ${queueUrl.split('/').pop()}\n\nThis action cannot be undone.`
    });

    if (result.response === 1) {
      const command = new PurgeQueueCommand({
        QueueUrl: queueUrl
      });
      
      await sqsClient.send(command);
      return { success: true, message: 'Queue purged successfully' };
    }
    
    return { success: false, message: 'Purge cancelled' };
  } catch (error) {
    console.error('Error purging queue:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('delete-queue', async (event, queueUrl) => {
  try {
    const queueName = queueUrl.split('/').pop();
    
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Delete Queue'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Queue Deletion',
      message: `Are you sure you want to delete the queue "${queueName}"?`,
      detail: 'This action cannot be undone. All messages in the queue will be lost permanently.'
    });

    if (result.response === 1) {
      const command = new DeleteQueueCommand({
        QueueUrl: queueUrl
      });
      
      await sqsClient.send(command);
      return { success: true, message: 'Queue deleted successfully' };
    }
    
    return { success: false, message: 'Deletion cancelled' };
  } catch (error) {
    console.error('Error deleting queue:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('check-connection', async () => {
  try {
    const command = new ListQueuesCommand({});
    await sqsClient.send(command);
    return { connected: true, region: currentRegion };
  } catch (error) {
    return { connected: false, error: error.message, region: currentRegion };
  }
});

ipcMain.handle('change-region', async (event, newRegion) => {
  try {
    currentRegion = newRegion;
    initializeSQSClient(newRegion);
    return { success: true, region: currentRegion };
  } catch (error) {
    return { success: false, error: error.message, region: currentRegion };
  }
});

ipcMain.handle('get-current-region', async () => {
  return { region: currentRegion };
});