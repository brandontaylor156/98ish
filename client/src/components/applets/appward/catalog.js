// Appward 98's app catalog: every app in the "smart set", by category, as a schema the
// record engine (engine.js) turns into lists, forms and detail pages. A field is written
// as a short string:
//   "Subject*"                 text, required (the first field is the record's title)
//   "Status=New|Open|Closed"   a choice (the first option is the default)
//   "Due:date"                 a type: text, long, rich, number, money, date, time, check,
//                              user (someone in the workspace), bom (parts list)
//   "Company:@companies"       a link to a record in another app
// `view` names a custom view some apps get on top of the generic list (board, feed...).

export const CATEGORIES = ["Productivity", "Sales", "People", "Operations", "Quality", "Manufacturing", "Development"]
export const CUSTOM_CATEGORY = "Custom Apps"

const DEPTS = "Department=Operations|Sales|Quality|Manufacturing|HR|Engineering"

export const APPS = [
  // ---- Productivity ----
  { id: "actions", name: "Actions", cat: "Productivity", icon: "check", prefix: "ACT", view: "board", board: "status",
    fields: ["Action*", "Status=To Do|In Progress|Waiting|Done", "Priority=Normal|High|Low", "Assignee:user", "Start:date", "Due:date", "Project:@projects", "Milestone:check", "Details:long"] },
  { id: "announcementDirector", name: "Announcement Director", cat: "Productivity", icon: "megaphone", prefix: "ANC",
    fields: ["Campaign*", "Audience=Everyone|Managers|Shop Floor|Sales", "Publish On:date", "Expires:date", "Status=Draft|Scheduled|Published", "Message:long"] },
  { id: "announcements", name: "Announcements", cat: "Productivity", icon: "megaphone", prefix: "ANN", view: "feed",
    fields: ["Headline*", "Body:long", "Author:user", "Posted:date", "Pinned:check", "Likes:number"] },
  { id: "articles", name: "Articles", cat: "Productivity", icon: "doc", prefix: "ART",
    fields: ["Title*", "Topic=General|How-To|Policy|Product", "Author:user", "Body:rich"] },
  { id: "boards", name: "Boards", cat: "Productivity", icon: "board", prefix: "BRD",
    fields: ["Board*", "Owner:user", "Columns", "Purpose:long"] },
  { id: "calendars", name: "Calendars", cat: "Productivity", icon: "calendar", prefix: "CAL", view: "calendar",
    fields: ["Event*", "Date:date", "Time:time", "Calendar=Company|Team|Personal", "Notes:long"] },
  { id: "companies", name: "Companies", cat: "Productivity", icon: "building", prefix: "CO",
    fields: ["Company*", "Industry=Manufacturing|Retail|Distribution|Services|Other", "Phone", "City", "Website", "Account Owner:user", "Notes:long"] },
  { id: "contacts", name: "Contacts", cat: "Productivity", icon: "person", prefix: "CT",
    fields: ["Name*", "Company:@companies", "Job Title", "Email", "Phone", "Notes:long"] },
  { id: "conversations", name: "Conversations", cat: "Productivity", icon: "chat", prefix: "CH", view: "chat",
    fields: ["Channel*", "Kind=Channel|Direct", "Topic"] },
  { id: "documents", name: "Documents", cat: "Productivity", icon: "doc", prefix: "DOC",
    fields: ["Title*", "Folder=General|Engineering|Quality|HR|Sales", "Owner:user", "Body:rich"] },
  { id: "forums", name: "Forums", cat: "Productivity", icon: "chat", prefix: "FOR",
    fields: ["Topic*", "Board=General|Ideas|Help", "Author:user", "Post:long", "Replies:number"] },
  { id: "insights", name: "Insights", cat: "Productivity", icon: "chart", prefix: "INS", view: "insights", noRecords: true, fields: [] },
  { id: "meetings", name: "Meetings", cat: "Productivity", icon: "calendar", prefix: "MTG",
    fields: ["Subject*", "Date:date", "Time:time", "Duration (min):number", "Location", "Organizer:user", "Attendees", "Agenda:long", "Minutes:rich"] },
  { id: "notes", name: "Notes", cat: "Productivity", icon: "note", prefix: "NOTE",
    fields: ["Title*", "Color=Yellow|Blue|Green|Pink", "Body:rich"] },
  { id: "whiteboards", name: "Whiteboards", cat: "Productivity", icon: "board", prefix: "WB",
    fields: ["Name*", "Owner:user", "Ideas:long"] },

  // ---- Sales ----
  { id: "installations", name: "Installations", cat: "Sales", icon: "wrench", prefix: "INST",
    fields: ["Site*", "Customer:@companies", "Install Date:date", "Technician:user", "Status=Scheduled|In Progress|Complete", "Notes:long"] },
  { id: "leads", name: "Leads", cat: "Sales", icon: "funnel", prefix: "LD", view: "board", board: "stage",
    fields: ["Lead*", "Company:@companies", "Contact:@contacts", "Stage=New|Qualified|Proposal|Negotiation|Won|Lost", "Value:money", "Owner:user", "Close Date:date", "Notes:long"] },
  { id: "supportContracts", name: "Support Contracts", cat: "Sales", icon: "doc", prefix: "SC",
    fields: ["Contract*", "Customer:@companies", "Level=Bronze|Silver|Gold", "Start:date", "End:date", "Value:money"] },
  { id: "territories", name: "Territories", cat: "Sales", icon: "globe", prefix: "TER",
    fields: ["Territory*", "Region=North|South|East|West|International", "Rep:user", "Notes:long"] },

  // ---- People ----
  { id: "employees", name: "Employees", cat: "People", icon: "person", prefix: "EMP",
    fields: ["Name*", "Position:@positions", DEPTS, "Email", "Phone", "Hire Date:date", "Manager:user"] },
  { id: "expenses", name: "Expenses", cat: "People", icon: "money", prefix: "EXP", approval: true,
    fields: ["Description*", "Category=Travel|Meals|Supplies|Tools|Training|Other", "Amount:money", "Date:date", "Submitted By:user", "Status=Pending|Approved|Denied", "Receipt Notes:long"] },
  { id: "goals", name: "Goals", cat: "People", icon: "target", prefix: "GOAL",
    fields: ["Goal*", "Owner:user", "Due:date", "Progress (%):number", "Status=On Track|At Risk|Behind|Done"] },
  { id: "positions", name: "Positions", cat: "People", icon: "person", prefix: "POS",
    fields: ["Title*", DEPTS, "Reports To", "Description:long"] },
  { id: "progressReports", name: "Progress Reports", cat: "People", icon: "chart", prefix: "PR",
    fields: ["Report*", "Employee:user", "Period", "Rating=Meets|Exceeds|Needs Work", "Summary:long"] },
  { id: "recruiting", name: "Recruiting", cat: "People", icon: "person", prefix: "REC", view: "board", board: "stage",
    fields: ["Candidate*", "Position:@positions", "Stage=Applied|Phone Screen|Interview|Offer|Hired|Declined", "Email", "Notes:long"] },
  { id: "reviews", name: "Reviews", cat: "People", icon: "star", prefix: "REV",
    fields: ["Review*", "Employee:user", "Reviewer:user", "Due:date", "Status=Not Started|In Progress|Complete", "Notes:long"] },
  { id: "safetyIncidents", name: "Safety Incidents", cat: "People", icon: "warning", prefix: "SI",
    fields: ["Incident*", "Date:date", "Location:@locations", "Severity=Near Miss|Minor|Recordable|Serious", "Reported By:user", "Status=Open|Investigating|Closed", "Description:long"] },
  { id: "shoutouts", name: "Shoutouts", cat: "People", icon: "star", prefix: "SHO", view: "feed",
    fields: ["Message*", "To:user", "From:user", "Value=Teamwork|Customer First|Safety|Above & Beyond|Innovation", "Posted:date", "Cheers:number"] },
  { id: "skills", name: "Skills", cat: "People", icon: "target", prefix: "SK",
    fields: ["Skill*", "Category=Technical|Safety|Leadership|Software", "Description:long"] },
  { id: "suggestions", name: "Suggestions", cat: "People", icon: "bulb", prefix: "SUG",
    fields: ["Suggestion*", "Submitted By:user", "Area=Safety|Quality|Cost|Morale|Other", "Status=New|Under Review|Accepted|Declined", "Details:long"] },
  { id: "surveyDirector", name: "Survey Director", cat: "People", icon: "clipboard", prefix: "SD",
    fields: ["Campaign*", "Audience=Everyone|Managers|Shop Floor|Sales", "Opens:date", "Closes:date", "Status=Draft|Open|Closed"] },
  { id: "surveys", name: "Surveys", cat: "People", icon: "clipboard", prefix: "SRV",
    fields: ["Survey*", "Question 1", "Question 2", "Question 3", "Status=Draft|Open|Closed"] },
  { id: "timeOff", name: "Time Off", cat: "People", icon: "clock", prefix: "TO", approval: true,
    fields: ["Reason*", "Employee:user", "Type=Vacation|Sick|Personal|Holiday", "From:date", "To:date", "Days:number", "Status=Pending|Approved|Denied"] },
  { id: "training", name: "Training", cat: "People", icon: "book", prefix: "TRN",
    fields: ["Course*", "Employee:user", "Skill:@skills", "Due:date", "Status=Assigned|In Progress|Complete"] },
  { id: "trainingDirector", name: "Training Director", cat: "People", icon: "book", prefix: "TD",
    fields: ["Program*", "Audience=Everyone|Managers|Shop Floor|Sales", "Courses:long", "Status=Draft|Active|Retired"] },
  { id: "trips", name: "Trips", cat: "People", icon: "globe", prefix: "TRP",
    fields: ["Trip*", "Traveler:user", "Destination", "Depart:date", "Return:date", "Status=Planned|Booked|Complete", "Purpose:long"] },
  { id: "wages", name: "Wages", cat: "People", icon: "money", prefix: "WG",
    fields: ["Pay Grade*", "Employee:user", "Rate:money", "Effective:date", "Notes:long"] },

  // ---- Operations ----
  { id: "assets", name: "Assets", cat: "Operations", icon: "gear", prefix: "AST",
    fields: ["Asset*", "Tag", "Location:@locations", "Status=In Service|Down|Retired", "Purchased:date", "Value:money"] },
  { id: "deliveries", name: "Deliveries", cat: "Operations", icon: "truck", prefix: "DLV",
    fields: ["Delivery*", "Customer:@companies", "Date:date", "Driver:user", "Status=Scheduled|Out|Delivered"] },
  { id: "licenses", name: "Licenses", cat: "Operations", icon: "key", prefix: "LIC",
    fields: ["License*", "Vendor", "Seats:number", "Expires:date", "Cost:money"] },
  { id: "locations", name: "Locations", cat: "Operations", icon: "pin", prefix: "LOC",
    fields: ["Location*", "Type=Plant|Warehouse|Office|Bay", "Address"] },
  { id: "maintenance", name: "Maintenance", cat: "Operations", icon: "wrench", prefix: "MNT",
    fields: ["Job*", "Asset:@assets", "Type=Preventive|Repair|Inspection", "Due:date", "Technician:user", "Status=Open|In Progress|Done", "Notes:long"] },
  { id: "maintenanceDirector", name: "Maintenance Director", cat: "Operations", icon: "wrench", prefix: "MD",
    fields: ["Schedule*", "Asset:@assets", "Every (days):number", "Next Due:date", "Checklist:long"] },
  { id: "markups", name: "Markups", cat: "Operations", icon: "pencil", prefix: "MK",
    fields: ["Markup*", "Drawing:@drawings", "Author:user", "Comment:long"] },
  { id: "pinpoint", name: "Pinpoint", cat: "Operations", icon: "pin", prefix: "PIN",
    fields: ["Pin*", "Location:@locations", "Grid", "Note:long"] },
  { id: "projects", name: "Projects", cat: "Operations", icon: "gantt", prefix: "PRJ", view: "timeline",
    fields: ["Project*", "Customer:@companies", "Manager:user", "Start:date", "End:date", "Status=Planning|Active|On Hold|Complete", "Budget:money", "Description:long"] },
  { id: "purchaseOrders", name: "Purchase Orders", cat: "Operations", icon: "cart", prefix: "PO",
    fields: ["PO*", "Vendor", "Part:@parts", "Qty:number", "Total:money", "Status=Draft|Sent|Partially Received|Received", "Order Date:date"] },
  { id: "purchaseRequests", name: "Purchase Requests", cat: "Operations", icon: "cart", prefix: "PRQ", approval: true,
    fields: ["Request*", "Requested By:user", "Part:@parts", "Qty:number", "Est. Cost:money", "Status=Pending|Approved|Denied"] },
  { id: "receiving", name: "Receiving", cat: "Operations", icon: "box", prefix: "RCV",
    fields: ["Receipt*", "Purchase Order:@purchaseOrders", "Received:date", "Qty:number", "Received By:user"] },
  { id: "safetySheets", name: "Safety Sheets", cat: "Operations", icon: "warning", prefix: "SDS",
    fields: ["Material*", "Supplier", "Hazard=None|Irritant|Flammable|Corrosive|Toxic", "Revised:date", "Handling:long"] },
  { id: "salesOrders", name: "Sales Orders", cat: "Operations", icon: "money", prefix: "SO",
    fields: ["Order*", "Customer:@companies", "Part:@parts", "Qty:number", "Total:money", "Ship By:date", "Status=Open|In Production|Shipped|Closed"] },
  { id: "shipping", name: "Shipping", cat: "Operations", icon: "truck", prefix: "SHP",
    fields: ["Shipment*", "Sales Order:@salesOrders", "Carrier=Truck|Parcel|Freight|Will Call", "Tracking", "Ship Date:date", "Status=Packing|Shipped|Delivered"] },
  { id: "specialEvents", name: "Special Events", cat: "Operations", icon: "party", prefix: "EVT",
    fields: ["Event*", "Date:date", "Location:@locations", "Host:user", "Notes:long"] },
  { id: "specialEventsDirector", name: "Special Events Director", cat: "Operations", icon: "party", prefix: "SED",
    fields: ["Plan*", "Event:@specialEvents", "Budget:money", "Status=Idea|Planning|Ready"] },
  { id: "ticketDirector", name: "Ticket Director", cat: "Operations", icon: "ticket", prefix: "TQ",
    fields: ["Queue*", "Owner:user", "Auto Assign:check", "Description:long"] },
  { id: "tickets", name: "Tickets", cat: "Operations", icon: "ticket", prefix: "TK", view: "board", board: "status",
    fields: ["Subject*", "Status=New|Open|Waiting|Resolved|Closed", "Priority=Normal|Low|High|Urgent", "Requester:@contacts", "Assignee:user", "Queue:@ticketDirector", "Description:long"] },

  // ---- Quality ----
  { id: "audits", name: "Audits", cat: "Quality", icon: "clipboard", prefix: "AUD",
    fields: ["Audit*", "Area", "Auditor:user", "Date:date", "Result=Scheduled|Pass|Minor Findings|Major Findings", "Notes:long"] },
  { id: "certifications", name: "Certifications", cat: "Quality", icon: "ribbon", prefix: "CERT",
    fields: ["Certification*", "Holder:user", "Issued:date", "Expires:date"] },
  { id: "changes", name: "Changes", cat: "Quality", icon: "pencil", prefix: "CHG",
    fields: ["Change*", "Part:@parts", "Requested By:user", "Status=Proposed|Approved|Implemented|Rejected", "Reason:long"] },
  { id: "inspections", name: "Inspections", cat: "Quality", icon: "magnifier", prefix: "INSP",
    fields: ["Inspection*", "Part:@parts", "Work Order:@workOrders", "Inspector:user", "Date:date", "Result=Pending|Pass|Fail", "Notes:long"] },
  { id: "problems", name: "Problems", cat: "Quality", icon: "warning", prefix: "PRB",
    fields: ["Problem*", "Part:@parts", "Severity=Medium|Low|High|Critical", "Owner:user", "Status=Open|Containment|Corrective Action|Closed", "Root Cause:long"] },

  // ---- Manufacturing ----
  { id: "drawings", name: "Drawings", cat: "Manufacturing", icon: "ruler", prefix: "DWG",
    fields: ["Drawing*", "Part:@parts", "Revision", "Drawn By:user", "Status=Draft|Released|Obsolete"] },
  { id: "inventory", name: "Inventory", cat: "Manufacturing", icon: "box", prefix: "INV",
    fields: ["Part:@parts*", "Location:@locations", "On Hand:number", "Reorder At:number", "Bin"] },
  { id: "laborTracking", name: "Labor Tracking", cat: "Manufacturing", icon: "clock", prefix: "LBR",
    fields: ["Task*", "Employee:user", "Work Order:@workOrders", "Hours:number", "Date:date"] },
  { id: "parts", name: "Parts", cat: "Manufacturing", icon: "gear", prefix: "PT",
    fields: ["Part Number*", "Description", "Type=Component|Raw Material|Finished Good", "Unit Cost:money", "Components:bom"] },
  { id: "workOrderDirector", name: "Work Order Director", cat: "Manufacturing", icon: "factory", prefix: "WOD",
    fields: ["Line*", "Supervisor:user", "Shift=1st|2nd|3rd", "Notes:long"] },
  { id: "workOrders", name: "Work Orders", cat: "Manufacturing", icon: "factory", prefix: "WO", view: "board", board: "status",
    fields: ["Work Order*", "Part:@parts", "Qty:number", "Status=Planned|Released|In Progress|Complete", "Due:date", "Location:@locations", "Line:@workOrderDirector"] },

  // ---- Development ----
  { id: "appCreator", name: "App Creator", cat: "Development", icon: "wand", prefix: "APP", view: "appCreator", noRecords: true, fields: [] },
  { id: "checklistCreator", name: "Checklist Creator", cat: "Development", icon: "check", prefix: "CL",
    fields: ["Checklist*", "Owner:user", "Items:long"] },
  { id: "databaseManager", name: "Database Manager", cat: "Development", icon: "database", prefix: "DB", view: "database", noRecords: true, fields: [] },
  { id: "queries", name: "Queries", cat: "Development", icon: "magnifier", prefix: "QRY",
    fields: ["Query*", "Table", "Criteria", "Notes:long"] },
  { id: "reportBuilder", name: "Report Builder", cat: "Development", icon: "report", prefix: "RPT", view: "reportBuilder", noRecords: true, fields: [] },
  { id: "scriptHub", name: "Script Hub", cat: "Development", icon: "script", prefix: "SCR",
    fields: ["Script*", "Language=BASIC|Batch|Macro", "Code:long", "Description:long"] },
  { id: "tours", name: "Tours", cat: "Development", icon: "flag", prefix: "TOUR",
    fields: ["Tour*", "App", "Steps:long"] },

  // ---- not in the launcher: the messages inside Conversations ----
  { id: "messages", name: "Messages", cat: null, icon: "chat", prefix: "MSG", hidden: true,
    fields: ["Text*:long", "Channel:@conversations", "From:user", "Attachments:refs"] },
]

// the types App Creator offers, with their names in its field list
export const FIELD_TYPES = [
  { id: "text", label: "Text" },
  { id: "long", label: "Memo (long text)" },
  { id: "number", label: "Number" },
  { id: "money", label: "Currency" },
  { id: "date", label: "Date" },
  { id: "check", label: "Yes/No" },
  { id: "select", label: "Choice list" },
  { id: "user", label: "Person" },
]

// the icons App Creator lets a new app pick from (all drawn in icons.jsx)
export const CREATOR_ICONS = ["star", "box", "check", "clipboard", "flag", "bulb", "target", "party", "truck", "book", "key", "globe"]
