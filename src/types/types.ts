export type UserRole = 'Admin' | 'Manager' | 'Supervisor' | 'Clerk' | 'Data Entry Clerk' | 'Shipping Agent';

export interface ManifestLibraryEntry {
  id: string;
  file_name: string;
  file_type: string;          // 'pdf' | 'xlsx' | 'xls' | 'csv' | 'txt' | 'docx' | 'doc'
  storage_path: string;
  public_url: string;
  file_size: number | null;
  description: string | null;
  uploaded_by: string | null;
  uploader_name: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
}

export interface Container {
  container_id: string;
  vessel_name: string;
  arrival_date: string;
  destuff_date?: string | null;
  destuff_shed?: 'Shed 6' | 'Shed 7' | null;
  teu_size?: '20ft' | '40ft' | null;
  start_time: string | null;
  end_time: string | null;
  status: 'Scheduled' | 'In Process' | 'Completed';
  expected_cargo_count?: number | null;
  clerk_name?: string | null;
  clerk_signature?: string | null;
  agent_name?: string | null;
  agent_signature?: string | null;
  manifest_url?: string | null;
  manifest_txt_url?: string | null;
  created_at: string;
}

export interface Cargo {
  cargo_id: number;
  container_id: string;
  pallet_no: string | null;
  quantity: number | null;
  commodity: string;
  marks: string | null;
  bl_no: string | null;
  storage_location: string | null;
  damage: string | null;
  remarks: string | null;
  system_number: string | null;
  damage_photos: string[] | null;
  is_selected: boolean;
  created_at: string;
}

export interface UserWithProfile {
  id: string;
  username: string;
  full_name: string | null;
  role: UserRole;
}

export interface CargoSummary {
  container_id: string;
  vessel_name: string;
  commodity: string;
  total_quantity: number;
}

export interface DamageReportItem {
  container_id: string;
  cargo_id: number;
  bl_no: string | null;
  pallet_no: string | null;
  commodity: string;
  damage: string;
  remarks: string | null;
}

export interface LoginAuditEntry {
  id: number;
  user_id: string | null;
  username: string;
  role: string | null;
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}


export interface OocNote {
  id: string;
  container_id: string;
  marks: string;
  issue_date: string;
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  bill_of_lading_no: string | null;
  received_by: string | null;
  released_by: string | null;
  created_by: string | null;
  created_at: string;
  // joined
  containers?: {
    vessel_name: string;
    arrival_date: string | null;
    destuff_date: string | null;
    destuff_shed: string | null;
    clerk_name: string | null;
    agent_name: string | null;
  };
}

export interface AuditLogEntry {
  id: number;
  table_name: string;
  record_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  user_id: string | null;
  performed_at: string;
}


