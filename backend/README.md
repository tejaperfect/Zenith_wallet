# Zenith Wallet Hub - Backend API

A comprehensive expense management and wallet system backend built with Node.js, Express, and MongoDB.

## Features

- **User Management**: Registration, authentication, profile management
- **Group Management**: Create/join groups, manage members, invite system
- **Expense Management**: Personal and group expenses with smart splitting
- **Payment System**: Wallet transfers, settlements, transaction tracking
- **Security**: JWT authentication, input validation, rate limiting

## Quick Start

### Prerequisites

- Node.js (v16 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn

### Installation

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment configuration:
```bash
cp .env.example .env
```

4. Update `.env` file with your configuration:
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zenith-wallet-hub
JWT_SECRET=your-super-secret-jwt-key
# ... other configuration
```

5. Start MongoDB service on your system

6. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:5000`

### Health Check

Visit `http://localhost:5000/api/health` to verify the server is running.

## API Documentation

### Authentication Endpoints

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user info

### User Management

- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `POST /api/users/upi-accounts` - Add UPI account
- `GET /api/users/search` - Search users

### Group Management

- `GET /api/groups` - Get user's groups
- `POST /api/groups` - Create new group
- `GET /api/groups/:groupId` - Get group details
- `PUT /api/groups/:groupId` - Update group
- `POST /api/groups/:groupId/invite` - Invite members
- `POST /api/groups/join/:joinCode` - Join by code

### Expense Management

- `GET /api/expenses` - Get expenses
- `POST /api/expenses` - Create expense
- `GET /api/expenses/:expenseId` - Get expense details
- `PUT /api/expenses/:expenseId` - Update expense
- `POST /api/expenses/:expenseId/settle` - Mark as settled

### Payment & Transactions

- `GET /api/transactions` - Get transactions
- `POST /api/transactions` - Create transaction
- `POST /api/payments/send-money` - Send money to user
- `POST /api/payments/settle-expense` - Settle expense
- `GET /api/payments/wallet-balance` - Get wallet balance

## Database Schema

### User Model
- Personal information and authentication
- Wallet balance and payment accounts
- Security settings and preferences
- Group memberships

### Group Model
- Group details and settings
- Member management with roles
- Settlement history
- Join codes for public groups

### Expense Model
- Expense details and categorization
- Smart splitting (equal, percentage, custom, shares)
- Settlement tracking
- Receipt attachments and notes

### Transaction Model
- Payment processing and tracking
- Balance updates
- Settlement records
- Recurring transactions

## Security Features

- JWT-based authentication with refresh tokens
- Password hashing with bcrypt
- Rate limiting to prevent abuse
- Input validation and sanitization
- CORS configuration for frontend integration

## Development

### Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm start` - Start production server
- `npm test` - Run tests (to be implemented)

### Environment Variables

Key environment variables required:

- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 5000)
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing secret
- `JWT_REFRESH_SECRET` - Refresh token secret
- `CLIENT_URL` - Frontend URL for CORS

### Error Handling

The API uses consistent error response format:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [] // Validation errors if any
}
```

### Response Format

Successful responses follow this format:

```json
{
  "success": true,
  "message": "Operation description",
  "data": {
    // Response data
  }
}
```

## Testing

To test the API endpoints, you can:

1. Use Postman or similar API testing tools
2. Check the health endpoint: `GET /api/health`
3. Register a test user: `POST /api/auth/register`
4. Login and get token: `POST /api/auth/login`
5. Use the token for authenticated endpoints

## Deployment

For production deployment:

1. Set `NODE_ENV=production`
2. Use a production MongoDB instance
3. Configure secure JWT secrets
4. Set up proper CORS origins
5. Use environment variables for all sensitive data
6. Consider using PM2 or similar process manager

## Contributing

1. Follow the existing code structure
2. Add proper error handling
3. Include input validation
4. Update documentation for new endpoints
5. Test thoroughly before submitting changes

## License

MIT License - see LICENSE file for details