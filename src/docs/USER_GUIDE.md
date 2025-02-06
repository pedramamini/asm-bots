# ASM Bots User Guide

## Introduction
ASM Bots is a web-based Core Wars arena where you can create, battle, and analyze assembly language bots. This guide will help you get started with the platform and explain its key features.

## Getting Started

### Account Creation
1. Visit the ASM Bots platform
2. Click "Register" and provide:
   - Username
   - Email address
   - Password (minimum 8 characters)
3. Verify your email address
4. Log in to access the platform

### Creating Your First Bot

#### Bot Editor
The bot editor provides a full-featured environment for writing assembly code:
- Syntax highlighting
- Real-time error checking
- Code completion
- Memory visualization

#### Basic Bot Structure
```assembly
; Example bot that copies itself
        org     start   ; Set starting position
start   mov     #4, #0  ; Initialize counter
loop    mov     @ptr, <copy    ; Copy instruction
        add     #1, ptr  ; Increment source pointer
        djn     loop, #4 ; Decrement counter and jump
ptr     dat     #0, #start ; Source pointer
copy    dat     #0, #20    ; Destination pointer
```

#### Assembly Language Reference
- `mov`: Move data between locations
- `add`: Add values
- `sub`: Subtract values
- `jmp`: Jump to location
- `djn`: Decrement and jump if non-zero
- `dat`: Store data
- Full reference available in the editor's help panel

### Battle System

#### Starting a Battle
1. Click "New Battle" in the dashboard
2. Select two bots to compete
3. Choose battle settings:
   - Memory size (default: 8000 cells)
   - Max cycles (default: 80,000)
   - Initial distance (default: 1000 cells)

#### Battle Visualization
The battle interface shows:
- Real-time memory state
- Bot positions and activity
- Execution trace
- Performance metrics

#### Memory Display
- Green: Active bot code
- Red: Protected memory
- Yellow: Recently modified cells
- Gray: Empty/unused cells

### Memory Visualization

#### Grid View
- 16x16 grid showing memory contents
- Color-coded for different states
- Hover for detailed cell information
- Click to inspect memory locations

#### Controls
- Play/Pause: Control execution
- Step: Execute one instruction
- Reset: Return to initial state
- Speed: Adjust execution speed
- Jump: Go to specific cycle

### Leaderboard System

#### Ranking Calculation
Points are awarded based on:
- Wins: +100 points
- Losses: -50 points
- Quick wins: Bonus points
- Consecutive wins: Multiplier bonus

#### Statistics
View detailed statistics:
- Win/loss ratio
- Average battle duration
- Memory efficiency
- Most successful strategies

## Advanced Features

### Battle Analysis
After each battle, analyze:
- Execution patterns
- Memory usage
- Critical moments
- Winning strategies

### Bot Optimization
Tips for improving your bot:
1. Minimize code size
2. Use self-replication
3. Implement defensive strategies
4. Optimize memory access patterns

### Performance Monitoring
Track your bot's performance:
- CPU usage
- Memory efficiency
- Execution speed
- Success rate

## Troubleshooting

### Common Issues
1. **Bot fails to load**
   - Check syntax errors
   - Verify memory constraints
   - Ensure valid entry point

2. **Battle doesn't start**
   - Confirm both bots are valid
   - Check memory settings
   - Verify server connection

3. **Performance issues**
   - Reduce visualization complexity
   - Close unnecessary browser tabs
   - Check network connection

### Support
- Discord community: [discord.gg/asm-bots](https://discord.gg/asm-bots)
- GitHub issues: [github.com/pedramamini/asm-bots/issues](https://github.com/pedramamini/asm-bots/issues)
- Email support: support@asm-bots.example.com

## Best Practices

### Bot Development
1. Start with simple, working code
2. Test against various opponents
3. Implement defensive measures
4. Optimize gradually
5. Document your code

### Battle Strategy
1. Analyze opponent patterns
2. Diversify attack methods
3. Include self-repair mechanisms
4. Use memory efficiently
5. Plan for long battles

### Community Guidelines
1. Keep code original
2. Share knowledge
3. Provide constructive feedback
4. Report bugs and issues
5. Follow fair play principles

## Keyboard Shortcuts

### Editor
- `Ctrl+S`: Save bot
- `Ctrl+R`: Run simulation
- `Ctrl+Space`: Code completion
- `F5`: Start battle
- `F8`: Step execution

### Battle View
- `Space`: Play/Pause
- `→`: Step forward
- `←`: Step backward
- `↑`: Increase speed
- `↓`: Decrease speed

## Updates and Changes
Stay informed about platform updates:
- Follow the changelog
- Join the Discord server
- Subscribe to the newsletter
- Watch the GitHub repository

Remember to check this guide periodically for updates and new features. Happy coding!