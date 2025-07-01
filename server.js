const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const robot = require('robotjs');
const screenshot = require('screenshot-desktop');
const path = require('path');
const fs = require('fs');

class AIDesktopServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);
        this.pendingConfirmations = new Map();
        this.currentScreenshot = null;
        
        this.setupExpress();
        this.setupSocketHandlers();
        this.setupRobot();
    }

    setupExpress() {
        this.app.use(express.static(__dirname));
        
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);

            socket.on('captureScreenshot', async () => {
                try {
                    const img = await screenshot();
                    const base64 = img.toString('base64');
                    this.currentScreenshot = base64;
                    socket.emit('screenshot', { image: base64 });
                } catch (error) {
                    console.error('Screenshot error:', error);
                    socket.emit('error', { message: 'Failed to capture screenshot' });
                }
            });

            socket.on('sendToAI', async (data) => {
                try {
                    await this.processAIRequest(socket, data);
                } catch (error) {
                    console.error('AI processing error:', error);
                    socket.emit('error', { message: 'Failed to process AI request' });
                }
            });

            socket.on('confirmation', (data) => {
                this.handleConfirmationResponse(socket, data);
            });

            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
            });
        });
    }

    setupRobot() {
        // Set robot.js options for better performance
        robot.setXDisplayName(process.env.DISPLAY || ':0.0');
        robot.setKeyboardDelay(50);
        robot.setMouseDelay(50);
    }

    async processAIRequest(socket, data) {
        const { message, conversationHistory } = data;
        
        try {
            // Prepare system message with current capabilities
            const systemMessage = {
                role: 'system',
                content: `You are an AI assistant that can control a desktop computer. You can see the current desktop screenshot and perform various actions.

Available actions:
- mouse_move: Move mouse to coordinates (x, y)
- mouse_click: Click at current mouse position or specific coordinates
- mouse_double_click: Double click at current position or coordinates
- keyboard_type: Type text
- keyboard_key: Press specific keys (like 'enter', 'tab', 'ctrl+c', etc.)
- open_terminal: Open terminal application
- run_command: Execute terminal command (REQUIRES CONFIRMATION)
- capture_screenshot: Take a new screenshot

Important rules:
1. ALWAYS ask for confirmation before running any terminal commands
2. Be descriptive about what you plan to do
3. For GUI interactions, use mouse and keyboard actions
4. If you need to see the current state, ask for a screenshot first
5. Be careful with coordinates - analyze the screenshot carefully

Current user request: "${message}"

Respond with a plan of what you want to do, and if needed, specify the exact actions to take. For any terminal commands, clearly state what command you want to run.`
            };

            // Include screenshot context if available
            const messages = [systemMessage];
            
            if (this.currentScreenshot) {
                messages.push({
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Here is the current desktop screenshot:'
                        },
                        {
                            type: 'image_url',
                            image_url: { url: `data:image/png;base64,${this.currentScreenshot}` }
                        }
                    ]
                });
            }

            // Add conversation history
            messages.push(...conversationHistory);

            // Call AI model
            const completion = await websim.chat.completions.create({
                messages: messages
            });

            const aiResponse = completion.content;
            
            // Parse AI response for actions
            await this.parseAndExecuteActions(socket, aiResponse);
            
            socket.emit('aiResponse', { message: aiResponse });

        } catch (error) {
            console.error('AI request processing error:', error);
            socket.emit('error', { message: 'Failed to process AI request' });
        }
    }

    async parseAndExecuteActions(socket, aiResponse) {
        // Simple action parsing - in a real implementation, you'd want more sophisticated parsing
        const actions = this.extractActionsFromResponse(aiResponse);
        
        for (const action of actions) {
            await this.executeAction(socket, action);
        }
    }

    extractActionsFromResponse(response) {
        const actions = [];
        
        // Look for common action patterns in the AI response
        const actionPatterns = [
            /run_command:\s*"([^"]+)"/gi,
            /keyboard_type:\s*"([^"]+)"/gi,
            /mouse_click:\s*\((\d+),\s*(\d+)\)/gi,
            /mouse_move:\s*\((\d+),\s*(\d+)\)/gi,
            /keyboard_key:\s*"([^"]+)"/gi,
            /open_terminal/gi
        ];

        // Extract terminal commands that need confirmation
        const commandMatches = response.match(/run_command:\s*"([^"]+)"/gi);
        if (commandMatches) {
            commandMatches.forEach(match => {
                const command = match.match(/"([^"]+)"/)[1];
                actions.push({
                    type: 'run_command',
                    command: command,
                    requiresConfirmation: true
                });
            });
        }

        // Extract other actions...
        const typeMatches = response.match(/keyboard_type:\s*"([^"]+)"/gi);
        if (typeMatches) {
            typeMatches.forEach(match => {
                const text = match.match(/"([^"]+)"/)[1];
                actions.push({
                    type: 'keyboard_type',
                    text: text
                });
            });
        }

        return actions;
    }

    async executeAction(socket, action) {
        try {
            if (action.requiresConfirmation) {
                return this.requestConfirmation(socket, action);
            }

            switch (action.type) {
                case 'mouse_move':
                    robot.moveMouse(action.x, action.y);
                    break;
                    
                case 'mouse_click':
                    if (action.x && action.y) {
                        robot.moveMouse(action.x, action.y);
                    }
                    robot.mouseClick();
                    break;
                    
                case 'mouse_double_click':
                    if (action.x && action.y) {
                        robot.moveMouse(action.x, action.y);
                    }
                    robot.mouseClick();
                    robot.mouseClick();
                    break;
                    
                case 'keyboard_type':
                    robot.typeString(action.text);
                    break;
                    
                case 'keyboard_key':
                    robot.keyTap(action.key);
                    break;
                    
                case 'open_terminal':
                    // Platform-specific terminal opening
                    if (process.platform === 'darwin') {
                        // macOS
                        robot.keyTap('space', 'cmd');
                        setTimeout(() => {
                            robot.typeString('Terminal');
                            robot.keyTap('enter');
                        }, 500);
                    } else if (process.platform === 'win32') {
                        // Windows
                        robot.keyTap('r', 'cmd');
                        setTimeout(() => {
                            robot.typeString('cmd');
                            robot.keyTap('enter');
                        }, 500);
                    } else {
                        // Linux
                        robot.keyTap('t', ['ctrl', 'alt']);
                    }
                    break;
            }

            socket.emit('actionExecuted', { action: action.type });
            
        } catch (error) {
            console.error('Action execution error:', error);
            socket.emit('error', { message: `Failed to execute action: ${action.type}` });
        }
    }

    requestConfirmation(socket, action) {
        const confirmationId = Date.now().toString();
        this.pendingConfirmations.set(confirmationId, {
            socket: socket,
            action: action,
            timestamp: Date.now()
        });

        socket.emit('confirmationRequired', {
            action: action.type,
            command: action.command,
            confirmationId: confirmationId
        });

        // Clean up old confirmations after 5 minutes
        setTimeout(() => {
            this.pendingConfirmations.delete(confirmationId);
        }, 5 * 60 * 1000);
    }

    async handleConfirmationResponse(socket, data) {
        const { action, command, approved } = data;
        
        if (approved) {
            try {
                if (action === 'run_command') {
                    await this.executeTerminalCommand(socket, command);
                }
            } catch (error) {
                console.error('Command execution error:', error);
                socket.emit('error', { message: 'Failed to execute command' });
            }
        } else {
            socket.emit('actionExecuted', { action: 'cancelled', command });
        }
    }

    async executeTerminalCommand(socket, command) {
        const { exec } = require('child_process');
        
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    socket.emit('error', { message: `Command failed: ${error.message}` });
                    reject(error);
                    return;
                }

                const output = stdout || stderr || 'Command executed successfully';
                socket.emit('actionExecuted', { 
                    action: 'command_executed', 
                    command,
                    output: output.substring(0, 1000) // Limit output length
                });
                resolve(output);
            });
        });
    }

    start(port = 3000) {
        this.server.listen(port, () => {
            console.log(`🤖 AI Desktop Controller running on http://localhost:${port}`);
            console.log('📸 Screenshot capability: Ready');
            console.log('🖱️  Mouse/Keyboard control: Ready');
            console.log('💬 AI Assistant: Ready');
        });
    }
}

// Start the server
const server = new AIDesktopServer();
server.start();

