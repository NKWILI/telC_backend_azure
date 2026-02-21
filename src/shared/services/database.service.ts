import { Injectable, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
    );
  }

  async onModuleInit() {
    try {
      // Test connection by querying activation_codes
      const { data, error } = await this.supabase
        .from('activation_codes')
        .select('*')
        .limit(1);

      if (error) {
        console.error('❌ Supabase connection failed:', error);
      } else {
        console.log('✅ Supabase connected successfully');
      }
    } catch (err) {
      console.error('❌ Database connection error:', err);
    }
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }
}
