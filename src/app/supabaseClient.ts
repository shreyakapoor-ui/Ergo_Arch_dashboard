// Shared Supabase client instance.
// Import from here everywhere — never call createClient() more than once.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ywnvnwsziqjhauyqgzjt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3bnZud3N6aXFqaGF1eXFnemp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNjUxODQsImV4cCI6MjA4NTg0MTE4NH0.VqANIUQSYsyAwTSZUIq7K_xFdd00iG0wiIT8U8bV_9o";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
