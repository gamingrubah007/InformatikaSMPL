// =====================================================================
// KONFIGURASI
// =====================================================================
// Mode 1 - COBA-COBA (default): biarkan SUPABASE_URL & SUPABASE_ANON_KEY kosong.
//   Data disimpan di browser ini saja (localStorage). Cocok untuk mencoba
//   tampilan. Siswa di perangkat lain TIDAK bisa melihat kuisnya.
//
// Mode 2 - ONLINE (untuk dipakai sungguhan): isi dua nilai di bawah dari
//   Supabase > Project Settings > API. Lihat PANDUAN.md.
window.KUIS_CONFIG = {
  SUPABASE_URL: "https://supabase.com/",       // contoh: "https://abcdxyz.supabase.co"
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YWp5d2xsbWV1bGFwbXVvd21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NDkzMDksImV4cCI6MjEwNzMyNTMwOX0.9xsUL77I0ZGjzqZl7khLGH4uc5iupow0de5EztsoCoU",  // kunci "anon public" (aman dipakai di sisi browser)

  // Hanya untuk mode coba-coba (localStorage). Ganti sesuka Anda.
  LOCAL_ADMIN_PASSWORD: "0460100071",

  APP_NAME: "Soal Informatika SMP Negeri L Sidoharjo"
};
