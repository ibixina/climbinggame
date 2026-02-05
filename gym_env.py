import gym
from gym import spaces
import numpy as np
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import time
import json
import os

class ClimbingGameEnv(gym.Env):
    metadata = {'render.modes': ['human']}

    def __init__(self, headless=True, game_path=None):
        super(ClimbingGameEnv, self).__init__()

        if game_path is None:
            # Default to looking in the current directory or a standard location
            game_path = "file://" + os.path.abspath("index_gym.html")
        
        self.game_path = game_path
        self.headless = headless

        # Action Space:
        # 0: Limb Selector (0: leftArm, 1: rightArm, 2: leftLeg, 3: rightLeg) - Mapped from continuous -1..1
        # 1: Target DX (-1..1) -> scaled to max reach
        # 2: Target DY (-1..1) -> scaled to max reach
        # 3: Grab Trigger (> 0.5 to grab/release)
        # 4: Piton Trigger (> 0.5 to place)
        # 5: Move X (-1..1) -> Ground movement
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(6,), dtype=np.float32)

        # Observation Space
        # Numeric: Player State + Limb States
        # Grid: 50x50 local wall map
        self.observation_space = spaces.Dict({
            "numeric": spaces.Box(low=-np.inf, high=np.inf, shape=(17,), dtype=np.float32), 
            # Player: relX, worldX, worldY, vy, stamina (5)
            # Limbs (4 * 3): x, y, state (12)
            # Total: 17
            "grid": spaces.Box(low=0, high=1, shape=(50, 50), dtype=np.float32)
        })

        self.driver = None
        self._launch_browser()

    def _launch_browser(self):
        chrome_options = Options()
        if self.headless:
            chrome_options.add_argument("--headless") 
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        
        # You might need to adjust the path to your chromedriver if it's not in PATH
        self.driver = webdriver.Chrome(options=chrome_options)
        self.driver.get(self.game_path)
        
        # Wait for game to load
        time.sleep(1)

    def reset(self):
        if self.driver is None:
            self._launch_browser()
            
        try:
            obs_json = self.driver.execute_script("return window.resetGame();")
            return self._process_obs(obs_json)
        except Exception as e:
            print(f"Error during reset: {e}")
            # Try reloading if things are broken
            self.driver.get(self.game_path)
            time.sleep(1)
            obs_json = self.driver.execute_script("return window.resetGame();")
            return self._process_obs(obs_json)

    def step(self, action):
        # Convert numpy array to list for JSON serialization
        action_list = action.tolist()
        
        # Execute step in JS
        # We pass the action array directly
        result = self.driver.execute_script(f"return window.step({json.dumps(action_list)});")
        
        obs = self._process_obs(result['observation'])
        reward = result['reward']
        done = result['done']
        info = result.get('info', {})
        
        return obs, reward, done, info

    def _process_obs(self, obs_dict):
        # Convert lists back to numpy arrays
        numeric = np.array(obs_dict['numeric'], dtype=np.float32)
        grid = np.array(obs_dict['grid'], dtype=np.float32).reshape((50, 50))
        return {
            "numeric": numeric,
            "grid": grid
        }

    def render(self, mode='human'):
        pass # Browser is already rendering if not headless

    def close(self):
        if self.driver:
            self.driver.quit()
            self.driver = None

if __name__ == "__main__":
    # Test run
    env = ClimbingGameEnv(headless=False)
    obs = env.reset()
    print("Initial observation shape:", obs['numeric'].shape, obs['grid'].shape)
    
    for _ in range(10):
        action = env.action_space.sample()
        obs, reward, done, info = env.step(action)
        print(f"Reward: {reward}, Done: {done}")
        if done:
            env.reset()
            
    env.close()
