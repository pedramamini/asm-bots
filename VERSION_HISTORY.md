# ASM-Bots Version History

## Version 2025.07.12a - Enhanced Battle System
Released: July 12, 2025

### Features
- **Random Memory Placement**: Bots are now randomly placed in memory instead of all starting at address 0
- **Random PC Start**: Each bot's Program Counter starts at a random position within their code
- **Real-time Memory Visualization**: Canvas-based visualization showing bot memory ownership
- **Hex Address Labels**: Memory visualization now shows hex addresses on the left side
- **PC Visualization**: Program counter positions shown with bright outlines and execution trails
- **WebSocket Battle Updates**: Live updates of battle progress and bot execution
- **Dark/Light Mode Toggle**: Theme switching for better viewing experience
- **Streaming Battle Logs**: Real-time execution logs with timestamp and details
- **Multi-bot Battles**: Support for multiple bots battling simultaneously
- **Winner Modal**: Victory screen showing battle statistics and winner information
- **Memory Footprint Tracking**: Each bot shows real-time memory usage in bytes
- **Enhanced Battle Controls**: Pause/Resume/Reset functionality with proper state management

### Technical Changes
- Modified BattleSystem to write bot code directly to shared memory
- Updated WebSocket handler to relocate bots to random addresses
- Fixed execution system to read from shared memory instead of process segments
- Added version tracking system with API endpoint

### Bug Fixes
- Fixed double file chooser dialog issue
- Fixed process creation scope issues
- Fixed dark mode styling for all components
- Fixed instruction decoding for proper execution

---

## Previous Versions

### Pre-2025.01.12
- Initial development by various AI platforms
- Basic Core Wars implementation
- Assembly parser and code generator
- Process management system
- Memory system implementation
- Basic web interface