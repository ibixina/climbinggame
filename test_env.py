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
        obs, info = self.env.reset()
        
        self.assertIn('numeric', obs)
        self.assertIn('grid', obs)
        
        self.assertEqual(obs['numeric'].shape, (17,))
        self.assertEqual(obs['grid'].shape, (50, 50))
        
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
        obs, reward, terminated, truncated, info = self.env.step(action)
        
        self.assertIsNotNone(obs)
        self.assertIsInstance(reward, (float, int))
        self.assertIsInstance(terminated, bool)
        self.assertIsInstance(truncated, bool)
        self.assertIsInstance(info, dict)
        
        self.assertEqual(obs['numeric'].shape, (17,))

    def test_reset(self):
        obs1, info1 = self.env.reset()
        for _ in range(5):
            self.env.step(self.env.action_space.sample())
            
        obs2, info2 = self.env.reset()
        
        self.assertAlmostEqual(obs1['numeric'][3], 0, delta=0.1)

if __name__ == '__main__':
    unittest.main()
