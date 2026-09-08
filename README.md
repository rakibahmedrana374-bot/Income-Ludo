# Ludo Master — Admin Ready

## Render
Build Command: `npm install`
Start Command: `npm start`

## Environment variables
Set these on Render:
- `JWT_SECRET` = long random secret
- `ADMIN_MOBILE` = your admin mobile
- `ADMIN_PASSWORD` = a strong admin password

## Admin
Open:
`https://YOUR-RENDER-DOMAIN/admin`

The admin panel includes:
- Dashboard
- Deposit approve/reject
- Withdraw approve/reject with refund on rejection
- Match create/delete
- User list and balances
- Winning approve/reject and prize credit
- Support inbox
- Announcement management

## Database
This version keeps JSON data in `data/database.json`. `data/.gitkeep` and `uploads/.gitkeep` are included.
For production real-money use, migrate to PostgreSQL and add proper audit logs, rate limiting, payment verification, role management, and jurisdiction-specific compliance.
