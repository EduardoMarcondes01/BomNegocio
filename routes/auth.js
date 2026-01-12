const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

router.post('/refresh', (req, res) => {
  const refreshToken = req.headers['x-refresh-token'];
  
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token não fornecido' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    const newToken = jwt.sign(
      { id: decoded.id, email: decoded.email },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const newRefreshToken = jwt.sign(
      { id: decoded.id, email: decoded.email },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    res
      .setHeader('x-new-token', newToken)
      .setHeader('x-new-refresh-token', newRefreshToken)
      .json({ success: true });
  } catch (error) {
    res.status(403).json({ error: 'Refresh token inválido' });
  }
});

module.exports = router;