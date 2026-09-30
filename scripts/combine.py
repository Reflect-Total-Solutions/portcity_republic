import os
import glob

output_file = r"d:\Reflective\portcity_republic\scripts\all-migrations.sql"
migrations_dir = r"d:\Reflective\portcity_republic\supabase\migrations"

files = [
    "001_create_auth_tables.sql",
    "002_create_categories.sql",
    "003_create_activities.sql",
    "004_create_transaction_groups.sql",
    "005_create_transactions.sql",
    "006_create_tokens.sql",
    "007_create_audit_log.sql",
    "008_create_error_logs.sql",
    "009_create_printer_status_cache.sql",
    "010_setup_sequences_and_functions.sql",
    "011_create_materialized_view.sql",
    "012_setup_rls_policies.sql",
    "013_add_activity_images.sql",
    "014_add_payment_methods.sql",
    "015_add_exchange_support.sql",
    "015_add_vendor_role.sql",
    "016_add_deleted_at_to_activities.sql",
    "016_create_exchange_transaction_rpc.sql",
    "017_add_is_exchanged_flag.sql",
    "018_add_activity_report_rpc.sql",
    "019_add_cashier_report_rpc.sql",
    "020_atomic_bulk_checkout.sql",
    "021_set_db_timezone_colombo.sql",
    "022_add_pos_transaction_indexes.sql",
    "023_add_pos_daily_summary_rpc.sql",
    "024_optimize_database_performance.sql",
    "025_fix_rls_admin_policies.sql"
]

os.makedirs(os.path.dirname(output_file), exist_ok=True)

with open(output_file, 'w', encoding='utf-8') as out_f:
    out_f.write("-- Port City Republic - Complete Database Schema\n")
    for f_name in files:
        f_path = os.path.join(migrations_dir, f_name)
        if os.path.exists(f_path):
            with open(f_path, 'r', encoding='utf-8') as in_f:
                content = in_f.read()
            out_f.write(f"\n-- ============================================\n")
            out_f.write(f"-- Migration: {f_name}\n")
            out_f.write(f"-- ============================================\n")
            out_f.write(content)
            if not content.endswith('\n'):
                out_f.write('\n')
        else:
            print(f"File not found: {f_path}")
print("Done")
