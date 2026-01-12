const jwt = require('jsonwebtoken');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      success: false,
      code: 'TOKEN_REQUIRED',
      error: 'Token não fornecido' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      const refreshToken = req.headers['x-refresh-token'];
      
      if (!refreshToken) {
        return res.status(401).json({ 
          success: false, 
          code: 'TOKEN_EXPIRED',
          error: 'Token expirado. Refresh token não fornecido' 
        });
      }

      try {
        const refreshDecoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        
        const newToken = jwt.sign(
          { id: refreshDecoded.id, email: refreshDecoded.email },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );

        const newRefreshToken = jwt.sign(
          { id: refreshDecoded.id },
          process.env.JWT_REFRESH_SECRET,
          { expiresIn: '7d' }
        );

        req.newTokens = {
          token: newToken,
          refreshToken: newRefreshToken
        };

        res.setHeader('x-new-token', newToken);
        res.setHeader('x-new-refresh-token', newRefreshToken);

        req.user = refreshDecoded;
        next();
      } catch (refreshError) {
        return res.status(403).json({ 
          success: false, 
          code: 'REFRESH_TOKEN_INVALID',
          error: 'Refresh token inválido ou expirado' 
        });
      }
    } else {
      return res.status(403).json({ 
        success: false, 
        code: 'TOKEN_INVALID',
        error: 'Token inválido' 
      });
    }
  }
};

// Exportar como CommonJS
module.exports = { verifyToken };
