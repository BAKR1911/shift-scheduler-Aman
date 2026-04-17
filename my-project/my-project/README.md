# IT Helpdesk Shift Scheduler

A comprehensive Next.js 16 application for managing IT helpdesk shift schedules and connection team assignments with multi-region support.

## Features

### Two Separate Systems

#### 1. Helpdesk System (Region-Based)
- **3 Supported Regions**: Cairo (القاهرة), Delta (الدلتا), Upper Egypt (الصعيد)
- Daily schedule auto-generation with fairness algorithm
- Complete region isolation - no cross-region data mixing
- Different working hours per day type (Weekday, Thursday, Friday, Saturday, Holiday)
- Holiday support - marked days are not scheduled
- Default Egyptian work week: Friday to Thursday
- Per-day hour editing via settings
- Monthly balancing across all generated months
- Employee swap functionality
- Manual shift addition

#### 2. Connection Team System (Global)
- Global workforce management (not region-isolated)
- Weekly-based manual assignments
- One employee can cover multiple regions in the same week
- Support for full/half/partial week assignments
- Track daily assignments, regions covered, weekly & monthly totals
- Connection team member replacement functionality

### User Management

**4 Roles with Hierarchical Permissions:**
- **super_admin** (implemented as admin): Full control over everything
- **admin**: Can see all regions, manage schedules, exports, and regeneration
- **editor**: Can edit only allowed modules and allowed regions
- **viewer**: Can only read allowed data

**User Creation Supports:**
- Role assignment
- Module access control: helpdesk, connection, or both
- Region scope configuration: one region, multiple regions, or all regions
- Helpdesk access is region-restricted
- Connection team access can be global

### Additional Features

- **Authentication**: Secure token-based authentication with HMAC verification
- **Export**: Excel export with 4 sheets (Schedule, Employee Summary, Connection Team, Cumulative Balance)
- **Reports**: Real-time statistics and balance tracking
- **Settings Management**: Shifts, holidays, summer time, per-day hours, week start configuration
- **Employee Management**: CRUD operations with region assignment and activation status
- **Database**: SQLite with Turso cloud support (fallback to in-memory for dev)

## Technology Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 with shadcn/ui components
- **Database**: SQLite (via @libsql/client) with custom ORM layer
- **Authentication**: Custom JWT-like token system with HMAC
- **Export**: ExcelJS for spreadsheet generation
- **Password Hashing**: bcryptjs

## Installation

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Run production server
bun run start
```

## Default Credentials

The application seeds a default admin user on first run:

- **Username**: `abubakr.ahmed`
- **Password**: `password123` (change immediately after first login)
- **Role**: Admin
- **Region**: All regions

## Environment Variables

```env
# Database (optional - falls back to in-memory SQLite)
TURSO_DATABASE_URL=file:./shift-scheduler.db

# JWT Secret (required for authentication)
JWT_SECRET=your-secret-key-here

# Other optional Next.js environment variables
NODE_ENV=development
```

## API Routes

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/check` - Verify authentication
- `POST /api/auth/change-password` - Change own password
- `POST /api/auth/reset-password` - Reset user password (admin)

### Helpdesk Schedule
- `GET /api/schedule` - Fetch schedule entries (filtered by month & region)
- `POST /api/schedule` - Generate schedule (month or week)
- `DELETE /api/schedule` - Clear schedule entries
- `POST /api/schedule/add-shift` - Add manual shift
- `POST /api/schedule/swap` - Swap two employees
- `DELETE /api/schedule/[date]` - Delete specific date entry

### Connection Team
- `GET /api/connection-team` - List connection team entries
- `POST /api/connection-team` - Create connection team assignment
- `DELETE /api/connection-team` - Remove connection team entry
- `GET /api/connection-assignments` - Fetch assignments & totals
- `POST /api/connection-assignments` - Create assignment
- `PUT /api/connection-assignments` - Update assignment
- `DELETE /api/connection-assignments` - Delete assignment

### Region Rotation
- `GET /api/region-rotation` - List rotation entries
- `POST /api/region-rotation` - Create rotation entry
- `PUT /api/region-rotation` - Update rotation entry
- `DELETE /api/region-rotation` - Delete rotation entry

### Management
- `GET /api/employees` - List employees (region-filtered for non-admin)
- `POST /api/employees` - Create employee
- `PUT /api/employees` - Update employee
- `DELETE /api/employees` - Delete employee (admin only)
- `GET /api/users` - List users (admin only)
- `POST /api/users` - Create user (admin only)
- `PUT /api/users/[id]` - Update user (admin only)
- `DELETE /api/users/[id]` - Delete user (admin only)

### Settings & Reports
- `GET /api/settings` - Get current settings
- `POST /api/settings` - Update settings (recalculates schedule)
- `GET /api/reports` - Get statistics and balance info
- `POST /api/export` - Export schedule as Excel
- `GET /api/download` - Download archived versions

## Database Schema

### Users
- `id` - Unique identifier
- `username` - Login username
- `password` - Hashed password (bcrypt)
- `email` - Email address
- `role` - User role (admin/editor/viewer)
- `region` - Allowed region (all/cairo/delta/upper_egypt)

### Employees
- `id` - Unique identifier
- `name` - Employee name
- `hrid` - HR ID
- `active` - Active status
- `order` - Display order
- `region` - Assigned region
- `team_type` - Team type (helpdesk/connection/both)

### Schedule Entries
- `date` - Date (YYYY-MM-DD)
- `day_name` - Day name (Friday, Saturday, etc.)
- `day_type` - Day type (Weekday, Thursday, Friday, Saturday, Holiday)
- `emp_idx` - Employee index for region
- `emp_name` - Employee name
- `emp_hrid` - Employee HR ID
- `start` - Shift start time
- `end` - Shift end time
- `hours` - Shift hours
- `off_person` - Off person name
- `off_person_idx` - Off person index
- `off_person_hrid` - Off person HR ID
- `week_num` - Week number within month
- `is_holiday` - Holiday flag
- `is_manual` - Manual entry flag
- `month_key` - Month key (YYYY-MM)
- `region` - Region identifier

### Connection Team
- `week_start` - Week start date
- `week_end` - Week end date
- `emp_idx` - Employee index
- `emp_name` - Employee name
- `emp_hrid` - Employee HR ID
- `month_key` - Month key
- `region` - Region

### Connection Assignments
- `employee_id` - Employee ID
- `date` - Assignment date
- `week_start` - Week start date
- `region_covered` - Region covered
- `hours` - Standard hours
- `override_hours` - Custom hours override

### Settings
- `shifts` - Shift configurations (JSON)
- `week_start` - Week start day
- `holidays` - Holiday dates (JSON array)
- `summer_time` - Summer time flag
- `summer_shifts` - Summer shift configs (JSON)
- `day_hours` - Per-day hour overrides (JSON)

## Fairness Algorithm

The helpdesk scheduling algorithm uses multiple factors to ensure fair distribution:

### Factors Considered:
1. **Cumulative Stats**: Tracks total hours, days, weekends worked across all months
2. **Monthly Stats**: Current month's hours, days, weekends
3. **OFF Weeks**: Tracks how many weeks each employee has had off
4. **Consecutive Days Prevention**: Avoids assigning same employee on consecutive days
5. **Weekend Fairness**: Balances Friday and Saturday assignments
6. **Holiday Consideration**: Holidays use separate shift configuration

### Post-Generation Optimization:
- Swaps employees between different weeks to reduce hour variance
- Maintains fairness while improving balance
- Iterates up to 15 times for optimal distribution

## Security Considerations

1. **Authentication**: All API routes (except login) require valid token
2. **Authorization**: Role-based access control enforced at route level
3. **Region Isolation**: Non-admin users can only access their assigned regions
4. **Password Hashing**: All passwords hashed with bcrypt (10 rounds)
5. **Token Verification**: HMAC signature prevents token tampering
6. **SQL Injection**: Parameterized queries throughout

## Deployment

### Vercel Deployment
```bash
# Install Vercel CLI
bun install -g vercel

# Deploy
vercel
```

Set the following environment variables in Vercel:
- `JWT_SECRET` - Strong random string
- `TURSO_DATABASE_URL` - Your Turso database URL (optional)

### Docker Deployment
```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY . .
RUN bun install
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "start"]
```

## Development

```bash
# Run linter
bun run lint

# Check types
bunx tsc --noEmit

# Database operations (no-op - auto-managed)
bun run db:push
bun run db:generate
bun run db:seed
```

## License

Proprietary - All Rights Reserved

## Support

For issues or questions, please contact the development team.

---

**Version**: v6-region-fixed
**Last Updated**: April 2026
**Framework**: Next.js 16.1.3
**Node.js**: Compatible with Bun runtime
