# Requirements Document

## 1. Application Overview

**Application Name:** Destuffing System

**Description:** A web-based cargo container destuffing management system for port/warehouse operations. The system tracks container arrivals, manages cargo destuffing processes, records cargo details, manages storage locations, generates operational reports, and manages container yard inventory. It supports role-based access control for administrators, clerks, and shipping agents.

## 2. Users and Usage Scenarios

**Target Users:**
- **Admin:** System administrators with full access to all features including user management
- **Clerk:** Operational staff who manage containers and cargo data
- **Shipping Agent:** External users with read-only access to containers and documentation

**Core Usage Scenarios:**
- Track container arrivals and destuffing progress
- Record cargo details during destuffing operations
- Monitor container status (In Process, Completed)
- View and manage cargo by storage location
- Generate reports for operational analysis
- Manage system users and access permissions
- View container information (shipping agents)
- Generate and manage Out of Charge (OOC) Notes
- Manage container yard inventory with import/manual entry
- Track container yard status (In/Out) and presence confirmation

## 3. Page Structure and Functionality

```
Destuffing System
├── Login Page (frmLogin)
├── Dashboard (frmDashboard)
├── Containers Management
│   └── Cargo Sub-form (frmCargoSub)
├── Location Management
├── Reports
│   ├── Summary Report
│   ├── Damage Report
│   └── Daily Destuffing Report
├── Documentation (OOC Notes)
├── Container Yard
└── User Management (Admin only)
```

### 3.1 Login Page (frmLogin)

**Purpose:** Authenticate users and control system access

**Functionality:**
- Input fields: Username, Password
- Login button to submit credentials
- Authenticate against tblUser (Username, Password)
- Redirect to Dashboard upon successful login
- Display error message for invalid credentials
- Store user role (Admin/Clerk/Shipping Agent) for session access control

**Sample Users:**
- Admin (Password: Admin123)
- Clerk1 (Password: Clerk123)
- Anniel Payne
- Keisha Dahlia

### 3.2 Dashboard (frmDashboard)

**Purpose:** Provide overview of system status and recent activities

**Functionality:**
- Display container statistics:
  - Total containers count
  - In-process containers count
  - Completed containers count
- Display cargo summary:
  - Total cargo quantity across all containers
- Show recent activity list (recent container updates)
- Navigation links to Containers Management, Location Management, Reports, Documentation, Container Yard, User Management

### 3.3 Containers Management

**Purpose:** Manage container records and track destuffing operations

**Functionality:**
- Display container list in table format with columns:
  - ContainerID (e.g., BSIU1234567)
  - VesselName (e.g., Tropic Jewel)
  - ArrivalDate
  - StartTime
  - EndTime
  - Status (In Process, Completed)
- Implement pagination or infinite scroll or lazy loading for container list
- Add new container (Admin and Clerk only):
  - Input fields: ContainerID, VesselName, ArrivalDate, StartTime, EndTime, Status
  - Save to tblContainers
- Edit existing container (Admin and Clerk only):
  - Load container data into form
  - Update fields
  - Save changes to tblContainers
- Delete container (Admin and Clerk only):
  - Remove container record from tblContainers
- Click container row to open Cargo Sub-form
- Status badge display for visual status indication
- Shipping Agent view:
  - Display container list in read-only mode
  - Hide Add, Edit, Delete buttons
  - Allow viewing container details by clicking row

### 3.4 Cargo Sub-form (frmCargoSub)

**Purpose:** Manage cargo items associated with a specific container

**Functionality:**
- Display container information (ContainerID, VesselName)
- Display cargo list in table format with columns:
  - Checkmark (checkbox column for entry selection)
  - CargoID
  - PalletNo
  - Quantity
  - Commodity
  - Marks
  - StorageLocation
  - Damage
  - Remarks
- Implement pagination or infinite scroll or lazy loading for cargo list
- **Entry Selection by Double Click:**
  - Double-click any cargo row to toggle checkmark on/off
  - Checkmark state persists in tblCargo (add IsSelected field)
  - Checkmark remains until manually removed by double-clicking again
- Add new cargo item (Admin and Clerk only):
  - Open Add Cargo modal form
  - Input fields: PalletNo, Quantity, Commodity, Marks, StorageLocation, Damage, Remarks
  - **Remember Last Pallet Number:** PalletNo field automatically prefills with last entered pallet number, user can edit
  - **Marks Field Size:** Marks input field is larger with increased display area for easier reading and editing
  - **Damage Type Dropdown:** Damage field is dropdown with options: Wet, Torn, Dented, B/O, Broken
  - Link to current ContainerID (FK)
  - Save to tblCargo
  - Display success notification
  - **Prevent Accidental Closure:**
    - Clicking outside modal does NOT close the form
    - Form only closes when user clicks Save button or X close button
    - If unsaved data exists when attempting to close, show confirmation warning dialog
- Edit existing cargo item (Admin and Clerk only):
  - Load cargo data into form
  - Update fields
  - **Marks Field Size:** Marks input field is larger with increased display area
  - **Damage Type Dropdown:** Damage field is dropdown with options: Wet, Torn, Dented, B/O, Broken
  - Save changes to tblCargo
  - Display success notification
- Delete cargo item (Admin and Clerk only):
  - Remove cargo record from tblCargo
- Return to Containers Management page
- Shipping Agent view:
  - Display cargo list in read-only mode
  - Hide Add, Edit, Delete buttons
  - Checkmark column visible but not editable

### 3.5 Location Management

**Purpose:** View and manage cargo organized by storage location

**Functionality:**
- Display all unique storage locations from tblCargo
- Implement pagination or infinite scroll or lazy loading for location list
- For each storage location, show:
  - Location name/identifier
  - Count of pallets at this location
  - List of cargo items including:
    - PalletNo
    - Commodity
    - Quantity
    - ContainerID
    - Damage status
  - **Automatic Pallet Sorting:** Pallets are automatically sorted in numerical order within each location
- Click location to expand and view full cargo details at that location
- Click cargo item to navigate to corresponding container/cargo detail page
- Search/filter locations by location name
- Display summary count of total pallets per location
- **Save All Locations Button:**
  - Display Save All Locations button at top or bottom of page
  - User can edit storage location assignments for multiple cargo items
  - Changes remain pending (not saved to database) until Save All Locations button is clicked
  - Clicking Save All Locations saves all pending location changes to tblCargo in one action
  - Display success notification after save

**Access Control:**
- Accessible to Admin and Clerk only

### 3.6 Reports

**Purpose:** Generate operational reports for analysis

#### 3.6.1 Summary Report
- Display total quantity per commodity per container
- Group by ContainerID and Commodity
- Show sum of Quantity for each group
- Implement pagination or infinite scroll or lazy loading for report results
- **Improved Summary Printing:**
  - Print button generates clean document pages
  - Each section starts on a separate page with page break
  - No app background, menus, navigation bars, or buttons in print output
  - Professional report format with proper margins
  - Optimized for Letter/A4 paper sizes

#### 3.6.2 Damage Report
- List all cargo items with damage notes
- Filter tblCargo where Damage field is not empty
- Display: ContainerID, CargoID, PalletNo, Commodity, Damage, Remarks
- Implement pagination or infinite scroll or lazy loading for report results
- **Improved Printing:** Same print optimization as Summary Report

#### 3.6.3 Daily Destuffing Report
- List containers by ArrivalDate
- Show container details and associated cargo count
- Filter by selected date
- Implement pagination or infinite scroll or lazy loading for report results
- **Improved Printing:** Same print optimization as Summary Report

**Access Control:**
- Accessible to Admin and Clerk only

### 3.7 Documentation (OOC Notes)

**Purpose:** Generate and manage Out of Charge (OOC) Notes for cargo release certification

**Functionality:**

**Generate OOC Note:**
- Select container from dropdown (displays ContainerID + VesselName)
- System retrieves all cargo items for selected container from tblCargo
- Cargo items are grouped by Marks field (consignee)
- Generate OOC Note displaying:
  - Header section:
    - Issue date (current date)
    - Container ID
    - Vessel name
    - Arrival date
    - Destuff date (EndTime from container)
    - Shed
  - Per mark/consignee section:
    - Mark/consignee name
    - List of cargo items: PalletNo, Commodity, Quantity, StorageLocation, Damage (if any)
    - Total quantity for this mark/consignee
  - Signature/certification area
- Optional remarks field for additional notes
- Print or download OOC Note as PDF
- **Improved Printing:** Clean document pages with no app background, menus, navigation bars, or buttons. Professional format with proper margins, optimized for Letter/A4 paper sizes
- Save generated note to tblOOCNotes (container_id, issue_date, remarks, created_by, created_at)

**View OOC Notes List:**
- Display list of generated OOC Notes in table format with columns:
  - Issue date
  - Container ID
  - Vessel name
  - Created by
  - Created at
- Implement pagination or infinite scroll or lazy loading for OOC Notes list
- Click note row to view/print full OOC Note
- When viewing a note, cargo data is fetched live from tblCargo based on container_id

**Delete OOC Note:**
- Admin only can delete individual OOC Note records from tblOOCNotes

**Clear All OOC Notes:**
- Display Clear All button in Documentation page
- When clicked, show confirmation dialog with warning message
- Upon confirmation, delete all OOC Note records from tblOOCNotes
- Display success notification after deletion
- Refresh OOC Notes list to show empty state

**Access Control:**
- Accessible to Admin and Shipping Agent only
- Clerk cannot access this section
- Delete function: Admin only
- Clear All function: Admin only

### 3.8 Container Yard

**Purpose:** Manage container yard inventory with import and manual entry capabilities

**Functionality:**

**Import Container List:**
- Upload CSV or Excel file containing container records
- File must include columns: Arrival Date, Container Number, TEUs, In or Out
- System parses file and imports records to tblContainerYard
- Display import success notification with count of imported records
- Display error message if file format is invalid or required columns are missing

**Manual Entry:**
- Add new container yard record:
  - Input fields:
    - Arrival Date (date picker)
    - Container Number (text input)
    - TEUs (number input)
    - In or Out (dropdown or toggle: In or Out)
    - Tick box (checkbox, default unchecked)
  - Save to tblContainerYard
  - Display success notification

**Container Yard Table View:**
- Display all container yard records in table format with columns:
  - Arrival Date
  - Container Number
  - TEUs
  - In or Out
  - Tick box (checkbox)
- Implement pagination or infinite scroll or lazy loading for container yard list
- Tick/untick checkbox directly in table:
  - Click checkbox to toggle tick status
  - Save updated tick status to tblContainerYard immediately
- Edit existing record (Admin and Clerk only):
  - Load record data into form
  - Update fields
  - Save changes to tblContainerYard
- Delete record (Admin and Clerk only):
  - Remove record from tblContainerYard

**Access Control:**
- Accessible to Admin and Clerk only
- Shipping Agent cannot access this section

### 3.9 User Management (Admin only)

**Purpose:** Manage system users and access permissions

**Functionality:**
- Display user list in table format with columns:
  - UserID
  - Username
  - FullName
  - Role (Admin/Clerk/Shipping Agent)
- Implement pagination or infinite scroll or lazy loading for user list
- Add new user:
  - Input fields: Username, Password, FullName, Role
  - Save to tblUser
- Edit existing user:
  - Load user data into form
  - Update fields (Username, Password, FullName, Role)
  - Save changes to tblUser
- Delete user:
  - Remove user record from tblUser

**Access Control:**
- Only accessible to users with Admin role
- Clerk and Shipping Agent users cannot access this page

## 4. Business Rules and Logic

### 4.1 Role-Based Access Control

| Role | Dashboard | Containers Management | Cargo Sub-form | Location Management | Reports | Documentation | Container Yard | User Management |
|------|-----------|----------------------|----------------|---------------------|---------|---------------|----------------|------------------|
| Admin | Yes | Yes (Full) | Yes (Full) | Yes | Yes | Yes (Full) | Yes | Yes |
| Clerk | Yes | Yes (Full) | Yes (Full) | Yes | Yes | No | Yes | No |
| Shipping Agent | Yes | Yes (Read-only) | Yes (Read-only) | No | No | Yes (View/Generate) | No | No |

**Shipping Agent Restrictions:**
- Containers Management: Read-only view, no Add/Edit/Delete buttons
- Cargo Sub-form: Read-only view, no Add/Edit/Delete buttons, checkmark column visible but not editable
- Can access Documentation section to view and generate OOC Notes, cannot delete or clear all
- Cannot access Location Management, Reports, Container Yard, User Management

**Documentation Access:**
- Admin: Full access (view, generate, delete, clear all OOC Notes)
- Shipping Agent: View and generate OOC Notes only, cannot delete or clear all
- Clerk: No access

**Container Yard Access:**
- Admin: Full access (import, manual entry, edit, delete, tick/untick)
- Clerk: Full access (import, manual entry, edit, delete, tick/untick)
- Shipping Agent: No access

### 4.2 Container Status Flow
- New container defaults to In Process status
- Status can be manually updated to Completed
- Completed containers remain in system for historical records

### 4.3 Data Relationships
- Each cargo item must be linked to a valid ContainerID (FK relationship)
- Deleting a container does not automatically delete associated cargo items
- Cargo items can only be added/edited when viewing a specific container
- StorageLocation field in tblCargo is used to group cargo in Location Management
- OOC Notes reference container_id but cargo data is fetched live from tblCargo when viewing/printing
- Container Yard records are independent and stored in tblContainerYard
- Cargo entry selection state is stored in tblCargo IsSelected field

### 4.4 Authentication
- Username and Password must match records in tblUser
- User role determines accessible features
- Session maintains user authentication state

### 4.5 OOC Note Generation Logic
- Issue date defaults to current date when generating note
- Cargo items are grouped by Marks field (consignee/mark)
- Total quantity is calculated per mark/consignee group
- Destuff date is derived from container EndTime field
- Created_by field records username of user who generated the note
- Created_at field records timestamp of note generation
- When viewing saved OOC Note, cargo data is retrieved from tblCargo in real-time to reflect current data

### 4.6 Container Yard Import Logic
- CSV/Excel file must contain columns: Arrival Date, Container Number, TEUs, In or Out
- System validates file format and required columns before import
- Duplicate Container Number entries are allowed (same container can have multiple yard records)
- Tick box defaults to unchecked for all imported records
- Import process creates new records in tblContainerYard

### 4.7 Cargo Entry Selection Logic
- Double-clicking a cargo row toggles IsSelected field in tblCargo
- Checkmark state persists across sessions until manually removed
- Checkmark is visible to all users but only editable by Admin and Clerk

### 4.8 Last Pallet Number Memory
- System stores last entered PalletNo value in session or user preference
- When Add Cargo form opens, PalletNo field prefills with last entered value
- User can edit or clear prefilled value before saving

### 4.9 Location Management Save Logic
- User can edit StorageLocation for multiple cargo items
- Changes are held in pending state (not saved to database)
- Clicking Save All Locations button commits all pending changes to tblCargo in one transaction
- If user navigates away without clicking Save All Locations, pending changes are discarded

### 4.10 Pallet Sorting Logic
- In Location Management, pallets are sorted numerically by PalletNo within each location
- Sorting is applied automatically when location is expanded or refreshed

### 4.11 Print Optimization Logic
- Print function applies print-specific styles to hide navigation, menus, buttons, and app background
- Each report section starts on a new page using page break
- Margins and layout are optimized for Letter/A4 paper sizes
- Print output contains only report content with professional formatting

### 4.12 Performance Optimization

**Database Indexing:**
- Add indexes on frequently queried columns:
  - tblContainers: ContainerID, Status, ArrivalDate
  - tblCargo: ContainerID, StorageLocation, Damage, Marks, IsSelected
  - tblUser: Username
  - tblOOCNotes: container_id, created_at
  - tblContainerYard: ContainerNumber, ArrivalDate

**Data Query Optimization:**
- Select only required columns in queries, avoid selecting all columns
- Apply filters on server-side before returning data
- Use server-side pagination for all listing pages

**Caching Strategy:**
- Apply caching headers for static assets
- Apply caching headers for API responses where data changes infrequently

**List Display Optimization:**
- All data listing pages must implement pagination or infinite scroll or lazy loading:
  - Containers Management
  - Cargo Sub-form
  - Location Management
  - All Reports (Summary, Damage, Daily Destuffing)
  - Documentation (OOC Notes list)
  - Container Yard
  - User Management

## 5. Exceptions and Boundary Cases

| Scenario | Handling |
|----------|----------|
| Invalid login credentials | Display error message, remain on login page |
| Duplicate ContainerID | Display error message, prevent save |
| Delete container with cargo items | Allow deletion, cargo items remain orphaned |
| Clerk attempts to access User Management | Redirect to Dashboard or display access denied message |
| Shipping Agent attempts to add/edit/delete container | Hide action buttons, display read-only view |
| Shipping Agent attempts to access Reports, Location Management, or Container Yard | Redirect to Dashboard or display access denied message |
| Clerk attempts to access Documentation | Redirect to Dashboard or display access denied message |
| Shipping Agent attempts to delete or clear all OOC Notes | Hide delete/clear all buttons, display access denied if attempted |
| Empty cargo list for container | Display empty state message in Cargo Sub-form |
| Missing required fields | Display validation error, prevent save |
| No cargo items at a storage location | Display empty state message in Location Management |
| Search returns no matching locations | Display no results message |
| Large dataset query timeout | Apply pagination and server-side filtering to limit result size |
| Slow page load due to large data volume | Implement lazy loading or infinite scroll to load data progressively |
| Generate OOC Note for container with no cargo | Display warning message, allow generation with empty cargo section |
| Container not found when generating OOC Note | Display error message, prevent generation |
| No OOC Notes in Documentation section | Display empty state message |
| View OOC Note but cargo data has been deleted | Display note with empty cargo section or placeholder message |
| PDF generation fails | Display error message, allow retry |
| Clear All OOC Notes with no notes present | Display message indicating no notes to clear |
| Clear All OOC Notes confirmation canceled | Close dialog, no action taken |
| Import file with invalid format | Display error message, prevent import |
| Import file missing required columns | Display error message, prevent import |
| Import file with invalid data types | Display error message, prevent import |
| No container yard records present | Display empty state message |
| Tick/untick checkbox fails to save | Display error message, revert checkbox state |
| User attempts to close Add Cargo form with unsaved data | Show confirmation warning dialog |
| User clicks outside Add Cargo modal | Modal remains open, no action taken |
| Last pallet number not available | PalletNo field remains empty |
| User navigates away from Location Management without clicking Save All Locations | Discard all pending location changes |
| Save All Locations fails | Display error message, retain pending changes for retry |
| Pallet numbers are non-numeric or mixed format | Sort pallets as strings in alphanumeric order |

## 6. Acceptance Criteria

1. Admin user logs in with username Admin and password Admin123, successfully enters Dashboard
2. Navigate to Containers Management, view container list including BSIU1234567 with vessel Tropic Jewel and status In Process, confirm pagination or infinite scroll or lazy loading is working
3. Click container BSIU1234567, open Cargo Sub-form displaying associated cargo items with checkmark column and pagination or infinite scroll or lazy loading
4. Double-click a cargo row, verify checkmark toggles on, double-click again to toggle off, verify checkmark state persists in tblCargo
5. Click Add Cargo button, verify PalletNo field prefills with last entered pallet number, user can edit it
6. In Add Cargo form, verify Marks field is larger with increased display area, Damage field is dropdown with options: Wet, Torn, Dented, B/O, Broken
7. Click outside Add Cargo modal, verify modal does NOT close
8. Enter data in Add Cargo form, click X close button, verify confirmation warning dialog appears, cancel to remain in form
9. Click Save button in Add Cargo form, verify cargo saves successfully with success notification and form closes
10. Navigate to Location Management, view all storage locations with pallet counts, verify pallets are sorted in numerical order within each location
11. Edit storage location for multiple cargo items, verify changes remain pending until Save All Locations button is clicked
12. Click Save All Locations button, verify all pending location changes save to tblCargo with success notification
13. Navigate to Reports, generate Summary Report, click Print button, verify clean document pages with no app background, menus, or buttons, each section starts on separate page with proper margins
14. Generate Damage Report and Daily Destuffing Report, verify same print optimization applies
15. Navigate to Documentation, select container BSIU1234567, generate OOC Note, click Print, verify clean professional format optimized for Letter/A4 paper
16. View OOC Notes list with pagination or infinite scroll or lazy loading, click a note to view full details with live cargo data from tblCargo
17. Click Clear All button in Documentation page, confirm dialog appears, confirm deletion, verify all OOC Notes are deleted and list shows empty state
18. Navigate to Container Yard, upload CSV file with columns (Arrival Date, Container Number, TEUs, In or Out), verify records are imported to tblContainerYard with success notification
19. Add new container yard record manually with Arrival Date 2026-06-05, Container Number TEST1234567, TEUs 2, In or Out In, save successfully
20. View Container Yard table with pagination or infinite scroll or lazy loading, tick checkbox for a container record, verify tick status is saved immediately
21. Admin navigates to User Management, view user list including Admin, Clerk1, Anniel Payne, Keisha Dahlia with pagination or infinite scroll or lazy loading, add a new Shipping Agent user
22. Logout and login as Shipping Agent, confirm Containers Management is accessible in read-only mode with no Add/Edit/Delete buttons, checkmark column visible but not editable
23. As Shipping Agent, confirm Documentation is accessible, can generate and view OOC Notes but cannot delete or clear all, Location Management, Reports, and Container Yard are not accessible
24. Logout and login as Clerk1 with password Clerk123, confirm User Management and Documentation are not accessible, Location Management and Container Yard are accessible
25. Verify database indexes are applied on ContainerID, Status, ArrivalDate in tblContainers, ContainerID, StorageLocation, Damage, Marks, IsSelected in tblCargo, Username in tblUser, container_id, created_at in tblOOCNotes, and ContainerNumber, ArrivalDate in tblContainerYard
26. Verify queries select only required columns and apply server-side filters
27. Verify caching headers are applied for static assets and appropriate API responses

## 7. Out of Scope for Current Release

- Email notifications for container status changes
- Barcode/QR code scanning for cargo items
- Photo upload for damage documentation
- Export reports to PDF or Excel
- Audit log for data changes
- Password reset functionality
- Multi-language support
- Mobile app version
- Real-time dashboard updates
- Advanced search and filtering across all pages
- Batch import of container/cargo data
- Integration with external shipping systems
- Automated status updates based on time rules
- Location capacity management
- Location-based alerts or notifications
- OOC Note templates customization
- OOC Note approval workflow
- OOC Note revision history or version control
- Batch generation of multiple OOC Notes
- Email delivery of OOC Notes to recipients
- Digital signature integration for OOC Notes
- Custom fields in OOC Note header or cargo sections
- Container Yard capacity limits or warnings
- Container Yard search and filtering
- Container Yard export to CSV/Excel
- Container Yard historical tracking or audit log
- Automated Container Yard status updates
- Container Yard integration with gate systems
- Bulk selection or deselection of cargo entries
- Undo/redo functionality for location changes
- Keyboard shortcuts for cargo entry selection
- Custom damage type options beyond predefined list