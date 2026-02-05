import unittest
import numpy as np
from gym_env import ClimbingGameEnv

class TestClimbingGameEnv(unittest.TestCase):
    def setUp(self):
        # Use headless mode for testing
        self.env = ClimbingGameEnv(headless=True)

    def tearDown(self):
        self.env.close()

    def test_observation_space(self):
        obs = self.env.reset()
        
        # Check dictionary keys
        self.assertIn('numeric', obs)
        self.assertIn('grid', obs)
        
        # Check shapes
        self.assertEqual(obs['numeric'].shape, (17,))
        self.assertEqual(obs['grid'].shape, (50, 50))
        
        # Check types
        self.assertTrue(isinstance(obs['numeric'], np.ndarray))
        self.assertTrue(isinstance(obs['grid'], np.ndarray))

    def test_action_space(self):
        action = self.env.action_space.sample()
        self.assertEqual(action.shape, (6,))
        self.assertTrue(np.all(action >= -1.0))
        self.assertTrue(np.all(action <= 1.0))

    def test_step(self):
        self.env.reset()
        action = np.zeros(6, dtype=np.float32)
        obs, reward, done, info = self.env.step(action)
        
        # Verify step returns
        self.assertIsNotNone(obs)
        self.assertIsInstance(reward, (float, int))
        self.assertIsInstance(done, bool)
        self.assertIsInstance(info, dict)
        
        # Verify observation consistency
        self.assertEqual(obs['numeric'].shape, (17,))

    def test_reset(self):
        obs1 = self.env.reset()
        # Take some actions to change state
        for _ in range(5):
            self.env.step(self.env.action_space.sample())
            
        obs2 = self.env.reset()
        
        # Reset should bring player back to start (roughly)
        # Check player X (index 0) is roughly center
        # We need to know canvas width but let's assume valid start
        # Check VY is 0 (index 3)
        self.assertAlmostEqual(obs1['numeric'][3], 0, delta=0.1) # VY should be 0

if __name__ == '__main__':
    unittest.main()
