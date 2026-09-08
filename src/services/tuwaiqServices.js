// Helper to match a UiPath process from the folder with the corresponding Tuwaiq service
// Supports:
// 1. Explicit Release Keys configured in .env (VITE_UIPATH_RELEASE_KEY_*)
// 2. User manual override / link
// 3. Smart Name & Description keyword matching
export function getServiceForProcess(proc, manualServiceId = null) {
  if (!proc) return TUWAIQ_SERVICES[0];

  // 1. Check if user selected a manual service override
  if (manualServiceId) {
    const found = TUWAIQ_SERVICES.find((s) => s.id === manualServiceId);
    if (found) return found;
  }

  // 2. Check if .env has specified a Release Key for any of the services
  const releaseKey = proc.Key;
  if (releaseKey) {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

    if (env.VITE_UIPATH_RELEASE_KEY_CUSTOMER_INFO && env.VITE_UIPATH_RELEASE_KEY_CUSTOMER_INFO === releaseKey) {
      return TUWAIQ_SERVICES.find((s) => s.id === 'FETCH_CUSTOMER_INFO') || TUWAIQ_SERVICES[0];
    }
    if (env.VITE_UIPATH_RELEASE_KEY_COORDINATES && env.VITE_UIPATH_RELEASE_KEY_COORDINATES === releaseKey) {
      return TUWAIQ_SERVICES.find((s) => s.id === 'FETCH_CUSTOMER_COORDINATES') || TUWAIQ_SERVICES[1];
    }
    if (env.VITE_UIPATH_RELEASE_KEY_ORDER_DETAILS && env.VITE_UIPATH_RELEASE_KEY_ORDER_DETAILS === releaseKey) {
      return TUWAIQ_SERVICES.find((s) => s.id === 'FETCH_ORDER_DETAILS') || TUWAIQ_SERVICES[2];
    }
    if (env.VITE_UIPATH_RELEASE_KEY_BILLING_DETAILS && env.VITE_UIPATH_RELEASE_KEY_BILLING_DETAILS === releaseKey) {
      return TUWAIQ_SERVICES.find((s) => s.id === 'FETCH_BILLING_DETAILS') || TUWAIQ_SERVICES[3];
    }
    if (env.VITE_UIPATH_RELEASE_KEY_SUPPORT_TICKETS && env.VITE_UIPATH_RELEASE_KEY_SUPPORT_TICKETS === releaseKey) {
      return TUWAIQ_SERVICES.find((s) => s.id === 'FETCH_SUPPORT_TICKETS') || TUWAIQ_SERVICES[4];
    }
    if (env.VITE_UIPATH_RELEASE_KEY_SIM_DEVICE && env.VITE_UIPATH_RELEASE_KEY_SIM_DEVICE === releaseKey) {
      return TUWAIQ_SERVICES.find((s) => s.id === 'FETCH_SIM_DEVICE_INFO') || TUWAIQ_SERVICES[5];
    }
  }

  // 3. Match by Process Name, Description, or ProcessKey keywords
  const targetText = `${proc.Name || ''} ${proc.Description || ''} ${proc.ProcessKey || ''}`.toLowerCase();

  for (const service of TUWAIQ_SERVICES) {
    if (service.aliases.some((alias) => targetText.includes(alias.toLowerCase()))) {
      return service;
    }
  }

  // Default fallback to first service
  return TUWAIQ_SERVICES[0];
}

// Generate dynamic fields from any raw outputs returned by an unattended UiPath job
export function generateDynamicFieldsFromOutput(rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'object') return [];
  return Object.keys(rawOutput).map((key) => {
    const formattedLabel = key
      .replace(/^out_/i, '')
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .trim();
    return {
      id: key,
      label: formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1),
      icon: '📊',
      placeholder: `e.g. ${rawOutput[key] || 'Output value'}`,
      keys: [key],
    };
  });
}


export const TUWAIQ_SERVICES = [
  {
    id: 'FETCH_CUSTOMER_INFO',
    name: 'Fetch Customer Info',
    aliases: ['fetch customer info', 'customer info', 'user details', 'fetch user details', 'customerinfo'],
    icon: '👤',
    description: 'Retrieves customer profile, verified name, email address, expenses, and membership tier.',
    fields: [
      {
        id: 'customerName',
        label: 'Customer Name',
        icon: '👤',
        placeholder: 'e.g. Abdullah Al-Mansoor',
        keys: [
          'CustomerName',
          'out_CustomerName',
          'Customer Name',
          'customer_name',
          'customerName',
          'Name',
          'out_Name',
          'name',
        ],
      },
      {
        id: 'customerEmail',
        label: 'Customer Email',
        icon: '✉️',
        placeholder: 'e.g. abdullah.mansoor@example.com',
        keys: [
          'CustomerEmail',
          'out_CustomerEmail',
          'Customer Email',
          'customer_email',
          'customerEmail',
          'Email',
          'out_Email',
          'email',
        ],
      },
      {
        id: 'customerExpenses',
        label: 'Customer Expenses',
        icon: '💳',
        placeholder: 'e.g. SAR 4,850.00',
        keys: [
          'CustomerExpenses',
          'out_CustomerExpenses',
          'Customer Expenses',
          'customer_expenses',
          'customerExpenses',
          'Expenses',
          'out_Expenses',
          'expenses',
          'TotalExpenses',
        ],
      },
      {
        id: 'loyaltyTier',
        label: 'Loyalty Tier & Status',
        icon: '⭐',
        placeholder: 'e.g. Platinum Member · Active',
        keys: [
          'LoyaltyTier',
          'out_LoyaltyTier',
          'Loyalty Tier',
          'AccountStatus',
          'out_AccountStatus',
          'tier',
          'status',
          'MembershipTier',
        ],
      },
    ],
  },
  {
    id: 'FETCH_CUSTOMER_COORDINATES',
    name: 'Fetch Customer Coordinates',
    aliases: ['fetch customer coordinates', 'customer coordinates', 'coordinates', 'location', 'fetch coordinates'],
    icon: '📍',
    description: 'Retrieves geographic coordinates, validated street address, city, and delivery zone.',
    fields: [
      {
        id: 'latitude',
        label: 'Latitude',
        icon: '🌐',
        placeholder: 'e.g. 24.7136° N',
        keys: [
          'Latitude',
          'out_Latitude',
          'latitude',
          'lat',
          'out_Lat',
          'GeoLatitude',
        ],
      },
      {
        id: 'longitude',
        label: 'Longitude',
        icon: '🌐',
        placeholder: 'e.g. 46.6753° E',
        keys: [
          'Longitude',
          'out_Longitude',
          'longitude',
          'lng',
          'lon',
          'out_Lng',
          'GeoLongitude',
        ],
      },
      {
        id: 'streetAddress',
        label: 'Street Address',
        icon: '🏠',
        placeholder: 'e.g. King Fahd Road, Al Olaya',
        keys: [
          'StreetAddress',
          'out_StreetAddress',
          'Address',
          'out_Address',
          'street_address',
          'address',
          'CustomerAddress',
        ],
      },
      {
        id: 'cityRegion',
        label: 'City & Region',
        icon: '🏙️',
        placeholder: 'e.g. Riyadh, Central Province',
        keys: [
          'City',
          'out_City',
          'Region',
          'out_Region',
          'CityRegion',
          'city',
          'District',
        ],
      },
      {
        id: 'postalCode',
        label: 'Postal / Area Code',
        icon: '📮',
        placeholder: 'e.g. 12214',
        keys: [
          'PostalCode',
          'out_PostalCode',
          'ZipCode',
          'postal_code',
          'zip',
          'AreaCode',
        ],
      },
    ],
  },
  {
    id: 'FETCH_ORDER_DETAILS',
    name: 'Fetch Order Details',
    aliases: ['fetch order details', 'order details', 'fetch order', 'orders', 'order'],
    icon: '📦',
    description: 'Retrieves latest customer order, invoice amount, tracking number, and delivery status.',
    fields: [
      {
        id: 'customerName',
        label: 'Customer Name',
        icon: '👤',
        placeholder: 'e.g. Fatima Al-Zahrani',
        keys: [
          'CustomerName',
          'out_CustomerName',
          'Customer Name',
          'customer_name',
          'customerName',
          'Name',
          'name',
        ],
      },
      {
        id: 'customerEmail',
        label: 'Customer Email',
        icon: '✉️',
        placeholder: 'e.g. fatima.z@example.com',
        keys: [
          'CustomerEmail',
          'out_CustomerEmail',
          'customer_email',
          'email',
        ],
      },
      {
        id: 'orderId',
        label: 'Order ID / Reference',
        icon: '🔖',
        placeholder: 'e.g. ORD-2026-88419',
        keys: [
          'OrderId',
          'out_OrderId',
          'OrderNumber',
          'order_id',
          'orderId',
          'Reference',
        ],
      },
      {
        id: 'orderAmount',
        label: 'Order Amount',
        icon: '💰',
        placeholder: 'e.g. SAR 789.50',
        keys: [
          'OrderAmount',
          'out_OrderAmount',
          'Order Amount',
          'amount',
          'TotalAmount',
          'orderAmount',
        ],
      },
      {
        id: 'orderStatus',
        label: 'Order & Shipping Status',
        icon: '🚚',
        placeholder: 'e.g. Out for Delivery · Arriving Today',
        keys: [
          'OrderStatus',
          'out_OrderStatus',
          'Status',
          'shipping_status',
          'DeliveryStatus',
          'orderStatus',
        ],
      },
    ],
  },
  {
    id: 'FETCH_BILLING_DETAILS',
    name: 'Fetch Billing Details',
    aliases: ['fetch billing details', 'billing details', 'billing', 'invoices', 'payment'],
    icon: '🧾',
    description: 'Retrieves outstanding invoice amount, due date, last payment, and payment method.',
    fields: [
      {
        id: 'outstandingBalance',
        label: 'Outstanding Balance',
        icon: '💳',
        placeholder: 'e.g. SAR 230.00',
        keys: [
          'OutstandingBalance',
          'out_OutstandingBalance',
          'Balance',
          'due_balance',
          'CurrentBalance',
        ],
      },
      {
        id: 'paymentDueDate',
        label: 'Payment Due Date',
        icon: '📅',
        placeholder: 'e.g. 15 Sep 2026',
        keys: [
          'DueDate',
          'out_DueDate',
          'PaymentDueDate',
          'due_date',
        ],
      },
      {
        id: 'lastPaymentAmount',
        label: 'Last Payment Amount',
        icon: '💵',
        placeholder: 'e.g. SAR 450.00',
        keys: [
          'LastPaymentAmount',
          'out_LastPaymentAmount',
          'LastPayment',
          'last_paid',
        ],
      },
      {
        id: 'billingStatus',
        label: 'Billing Status',
        icon: '🛡️',
        placeholder: 'e.g. Current / No Suspension',
        keys: [
          'BillingStatus',
          'out_BillingStatus',
          'PaymentStatus',
          'AccountStanding',
        ],
      },
      {
        id: 'paymentMethod',
        label: 'Saved Payment Method',
        icon: '🏧',
        placeholder: 'e.g. Mada Debit ending in ••8291',
        keys: [
          'PaymentMethod',
          'out_PaymentMethod',
          'CardType',
          'method',
        ],
      },
    ],
  },
  {
    id: 'FETCH_SUPPORT_TICKETS',
    name: 'Fetch Support Tickets',
    aliases: ['fetch support tickets', 'support tickets', 'tickets', 'crm tickets', 'inquiries'],
    icon: '🎧',
    description: 'Retrieves open customer CRM tickets, priority level, category, and resolution SLA.',
    fields: [
      {
        id: 'openTicketsCount',
        label: 'Open Tickets Count',
        icon: '🔢',
        placeholder: 'e.g. 1 Open Ticket',
        keys: [
          'OpenTicketsCount',
          'out_OpenTicketsCount',
          'TotalTickets',
          'open_tickets',
          'Count',
        ],
      },
      {
        id: 'latestTicketId',
        label: 'Latest Ticket ID',
        icon: '🎫',
        placeholder: 'e.g. TCK-99420',
        keys: [
          'LatestTicketId',
          'out_LatestTicketId',
          'TicketId',
          'ticket_id',
          'CaseNumber',
        ],
      },
      {
        id: 'issueCategory',
        label: 'Issue Category',
        icon: '📁',
        placeholder: 'e.g. Fiber Internet Connectivity',
        keys: [
          'IssueCategory',
          'out_IssueCategory',
          'Category',
          'issue_type',
          'Subject',
        ],
      },
      {
        id: 'ticketPriority',
        label: 'Priority Level',
        icon: '🚨',
        placeholder: 'e.g. High Priority',
        keys: [
          'Priority',
          'out_Priority',
          'TicketPriority',
          'severity',
        ],
      },
      {
        id: 'resolutionSla',
        label: 'Resolution SLA',
        icon: '⏱️',
        placeholder: 'e.g. Within 4 hours (Target: 14:00)',
        keys: [
          'ResolutionSla',
          'out_ResolutionSla',
          'SLA',
          'sla_status',
          'TargetTime',
        ],
      },
    ],
  },
  {
    id: 'FETCH_SIM_DEVICE_INFO',
    name: 'Fetch SIM & Device Info',
    aliases: ['fetch sim device info', 'sim device', 'sim info', 'device info', 'device verification'],
    icon: '📱',
    description: 'Retrieves registered device model, IMEI, eSIM/physical SIM state, and active roaming.',
    fields: [
      {
        id: 'deviceModel',
        label: 'Device Model',
        icon: '📱',
        placeholder: 'e.g. iPhone 16 Pro Max 256GB',
        keys: [
          'DeviceModel',
          'out_DeviceModel',
          'Device',
          'Handset',
          'model',
        ],
      },
      {
        id: 'simStatus',
        label: 'SIM / eSIM Status',
        icon: '📶',
        placeholder: 'e.g. eSIM Active (5G Standalone)',
        keys: [
          'SimStatus',
          'out_SimStatus',
          'SIMState',
          'sim_status',
        ],
      },
      {
        id: 'subscriptionTier',
        label: 'Subscription Plan',
        icon: '⚡',
        placeholder: 'e.g. Tuwaiq Unlimited Postpaid 5G',
        keys: [
          'SubscriptionTier',
          'out_SubscriptionTier',
          'Plan',
          'package',
        ],
      },
      {
        id: 'roamingStatus',
        label: 'Roaming Status',
        icon: '✈️',
        placeholder: 'e.g. GCC Roaming Bundle Enabled',
        keys: [
          'RoamingStatus',
          'out_RoamingStatus',
          'Roaming',
          'roaming_active',
        ],
      },
      {
        id: 'imeiNumber',
        label: 'IMEI / Serial Number',
        icon: '🔐',
        placeholder: 'e.g. 359124089201948',
        keys: [
          'ImeiNumber',
          'out_ImeiNumber',
          'IMEI',
          'imei',
          'SerialNumber',
        ],
      },
    ],
  },
];

// Helper to extract a value from UiPath output arguments by checking candidate keys
export function extractFieldValue(result, keys) {
  if (!result || typeof result !== 'object') return null;

  // 1. Direct match
  for (const k of keys) {
    if (result[k] !== undefined && result[k] !== null && result[k] !== '') {
      return String(result[k]);
    }
  }

  // 2. Case-insensitive & normalized match (strip spaces and underscores)
  const lowerMap = {};
  for (const [key, val] of Object.entries(result)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    lowerMap[norm] = val;
  }

  for (const k of keys) {
    const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lowerMap[normKey] !== undefined && lowerMap[normKey] !== null && lowerMap[normKey] !== '') {
      return String(lowerMap[normKey]);
    }
  }

  return null;
}

// Simulated fallback outputs for realistic call center testing if unattended robot has no queue
export function generateSimulatedOutput(serviceId, phoneNumber) {
  const cleanPhone = (phoneNumber || '0501234567').replace(/[^0-9]/g, '');
  const suffix = cleanPhone.slice(-4) || '8558';

  switch (serviceId) {
    case 'FETCH_CUSTOMER_INFO':
      return {
        CustomerName: 'Abdullah Al-Mansoor',
        CustomerEmail: `abdullah.mansoor.${suffix}@tuwaiq.sa`,
        CustomerExpenses: 'SAR 5,420.00',
        LoyaltyTier: 'VIP Platinum · Active Member',
      };
    case 'FETCH_CUSTOMER_COORDINATES':
      return {
        Latitude: '24.7136° N',
        Longitude: '46.6753° E',
        StreetAddress: 'King Fahd Road, Tower 4, Suite 12B',
        City: 'Riyadh, Al Olaya District',
        PostalCode: '12214',
      };
    case 'FETCH_ORDER_DETAILS':
      return {
        CustomerName: 'Abdullah Al-Mansoor',
        CustomerEmail: `abdullah.mansoor.${suffix}@tuwaiq.sa`,
        OrderId: `ORD-2026-${suffix}`,
        OrderAmount: 'SAR 1,299.00',
        OrderStatus: 'Out for Delivery (ETA: 16:30 Today)',
      };
    case 'FETCH_BILLING_DETAILS':
      return {
        OutstandingBalance: 'SAR 0.00 (Paid in Full)',
        DueDate: '28 Sep 2026',
        LastPaymentAmount: 'SAR 460.00',
        BillingStatus: 'Account Good Standing',
        PaymentMethod: `Mada ending in ••${suffix.slice(-2) || '42'}`,
      };
    case 'FETCH_SUPPORT_TICKETS':
      return {
        OpenTicketsCount: '0 Open Tickets (All Closed)',
        LatestTicketId: `TCK-2026-${suffix}`,
        IssueCategory: 'Fiber Speed Optimization',
        Priority: 'Standard',
        ResolutionSla: 'Resolved within 2 hours',
      };
    case 'FETCH_SIM_DEVICE_INFO':
      return {
        DeviceModel: 'Apple iPhone 16 Pro (A3294)',
        SimStatus: 'eSIM Activated (Tuwaiq 5G Ultra)',
        SubscriptionTier: 'Postpaid Black Unlimited',
        RoamingStatus: 'GCC & Global Roaming Enabled',
        ImeiNumber: `35981204892${suffix}`,
      };
    default:
      return {
        Status: 'Completed Successfully',
        PhoneQueried: phoneNumber,
      };
  }
}
