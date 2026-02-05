# Climbing Game & Gym Environment Project Context

## Project Overview
This project consists of a browser-based 2D Climbing Game and an OpenAI Gym (Gymnasium-compatible) environment wrapper that allows Reinforcement Learning (RL) agents to train on the game.

The game is built with vanilla JavaScript and HTML5 Canvas. The Gym environment uses Python and Selenium to interface with the game logic.

## Architecture

### 1. The Game Engine (`game.js` / `game_gym.js`)
- **`game.js`**: The original standalone game for human players.
- **`game_gym.js`**: A modified version of the game engine for RL training.
    - **Modifications**:
        - Automatic game loop (`requestAnimationFrame`) is disabled.
        - Exposes `window.step(action)` and `window.resetGame()` to the global scope.
        - `step(action)` executes one physics update, synchronizing the game clock with the agent's steps.
        - Returns structured observations (Numeric + Grid) and rewards directly to Python.

### 2. The Python Wrapper (`gym_env.py`)
- Defines `ClimbingGameEnv`, a custom class inheriting from `gym.Env`.
- **Communication**: Uses `selenium` to launch a headless Chrome browser loading `index_gym.html`.
- **Execution**:
    - `step(action)`: Serializes the action, executes `window.step(action)` via JavaScript injection, and deserializes the returned observation/reward.
    - `reset()`: Calls `window.resetGame()`.

## Key Files

- `game.js`: Original game logic (Human playable).
- `game_gym.js`: Modified game logic for AI control.
- `index.html`: Entry point for human play.
- `index_gym.html`: Entry point for AI training (loads `game_gym.js`).
- `gym_env.py`: Python Gym environment definition.
- `test_env.py`: Unit tests verifying the Gym interface.
- `requirements.txt`: Python dependencies (`gym`, `numpy`, `selenium`).

## RL Interface Details

### Action Space (`Box(6,)`)
Continuous vector with values in range `[-1, 1]`:
0. **Limb Selector**: Maps to Left/Right Arm/Leg.
1. **Target X**: Mouse/Hand target position X offset.
2. **Target Y**: Mouse/Hand target position Y offset.
3. **Grab Trigger**: > 0.5 triggers a grab attempt.
4. **Piton Trigger**: > 0.8 places a safety piton.
5. **Move X**: Ground movement control.

### Observation Space (`Dict`)
- **`numeric`** (`Box(17,)`):
    - Player: `[RelX, WorldX, WorldY, VelocityY, Stamina]`
    - Limbs (x4): `[RelX, RelY, State]` (State: 1=Grabbed, 0.5=Ground, 0=Free)
- **`grid`** (`Box(50, 50)`):
    - A 50x50 local grid of wall "grabbability" values centered on the player.

### Reward Function
- **Height Gain**: +10 * (New Max Height - Old Max Height).
- **Survival**: +0.01 per step (encourages not dying immediately).
- **Death**: -100 on Game Over.

## Setup & Usage

### Dependencies
Managed via `uv` (or pip).
```bash
uv pip install -r requirements.txt
```

### Running Tests
```bash
uv run test_env.py
```

### Using the Environment
```python
from gym_env import ClimbingGameEnv
env = ClimbingGameEnv(headless=True)
obs = env.reset()
obs, reward, done, info = env.step(env.action_space.sample())
```

## Future Work / Known Issues
- The `gym` library is older; consider upgrading to `gymnasium` if compatibility issues arise.
- `game_gym.js` must be manually synced if significant physics changes are made to `game.js`.
