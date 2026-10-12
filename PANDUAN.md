# Panduan KuisKu

Website kuis sederhana: guru membuat soal (ketik atau import dari Word), siswa mengerjakan lewat kode kuis, hasil tercatat otomatis.

## Isi folder

| File | Fungsi |
|---|---|
| `index.html` | Halaman siswa: masukkan kode kuis |
| `quiz.html` | Halaman pengerjaan soal dan hasil |
| `admin.html` | Halaman admin: buat/edit kuis, import Word, lihat hasil |
| `js/config.js` | **Satu-satunya file yang perlu Anda ubah** |
| `supabase.sql` | Skrip database untuk mode online |
| `template_soal.docx` | Contoh format Word untuk import |

## 1. Coba dulu di komputer

Buka `admin.html` dengan klik dua kali (kata sandi bawaan: `admin123`). Ini **mode coba-coba**: data hanya tersimpan di browser itu sendiri, jadi siswa di perangkat lain belum bisa melihat kuisnya. Cocok untuk melihat tampilan dan mencoba import Word.

## 2. Mengaktifkan mode online (supaya siswa bisa mengakses dari mana saja)

Website ini statis, jadi datanya disimpan di **Supabase** (database gratis). Langkah sekali saja:

1. Daftar di supabase.com, klik **New project**, pilih wilayah terdekat (mis. Singapore), catat kata sandi database.
2. Buka **SQL Editor > New query**, tempel seluruh isi `supabase.sql`, klik **Run**.
3. Buat akun admin: **Authentication > Users > Add user > Create new user**. Isi email dan kata sandi, centang **Auto Confirm User**.
4. **PENTING:** buka **Authentication > Sign In / Providers** (atau Settings), lalu **matikan "Allow new users to sign up"**. Kalau tidak, orang lain bisa mendaftar sendiri dan menjadi admin.
5. Buka **Project Settings > API**. Salin **Project URL** dan kunci **anon public**, tempel ke `js/config.js`:

```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

Kunci `anon` memang aman berada di sisi browser. Yang tidak boleh dibagikan adalah kunci `service_role` (jangan dipakai di sini).

Keamanan mode online: siswa tidak bisa membaca kunci jawaban (soal diambil lewat fungsi yang membuang kuncinya) dan penilaian dilakukan di server. Hanya akun admin yang bisa mengubah soal dan melihat hasil.

## 3. Hosting gratis

Karena semua file statis, cukup unggah isi folder ini ke salah satu layanan berikut:

- **Cloudflare Pages** (disarankan): bandwidth dan permintaan statis tanpa batas. Di dashboard pilih Workers & Pages > Create > Pages > **Upload assets**, lalu seret folder ini.
- **Netlify**: buka app.netlify.com/drop, seret folder ini.
- **GitHub Pages**: unggah ke repositori, aktifkan Pages di Settings.
- **Vercel**: impor repositori atau unggah folder.

Setelah online, bagikan ke siswa tautan `https://domain-anda/quiz.html?kode=KODEKUIS` (tombol "Salin tautan" di admin), atau minta mereka membuka `https://domain-anda/` dan mengetik kodenya.

Catatan: proyek Supabase gratis akan **dijeda otomatis jika tidak ada aktivitas selama 1 minggu**. Data tidak hilang, tetapi proyek harus diaktifkan kembali dari dashboard Supabase. Jika kuis dipakai berjarak lebih dari seminggu, cek dulu sehari sebelumnya.

## 4. Format soal di Word

```
1. Planet terbesar di tata surya adalah...
A. Bumi
B. Jupiter
C. Mars
D. Venus
Jawaban: B
Pembahasan: Jupiter adalah planet terbesar.

2. Ibu kota Prancis adalah... (isian singkat, tanpa pilihan)
Jawaban: Paris | paris
Skor: 2
```

- Nomor dan huruf boleh diketik biasa **atau** memakai penomoran otomatis Word.
- Kunci bisa juga ditandai dengan menebalkan/menggarisbawahi/meng-highlight seluruh teks pilihan yang benar, atau mengakhiri pilihan dengan `*`.
- Setelah dipilih, aplikasi menampilkan pratinjau dan menandai soal yang kuncinya belum terbaca.
- Gambar dan rumus (equation) tidak ikut terimpor. Gunakan format `.docx`, bukan `.doc` lama.
- Bisa juga menempelkan teks soal langsung di jendela import.

## 5. Pemecahan masalah

- **"Tidak bisa terhubung ke server"**: periksa `SUPABASE_URL`, dan pastikan proyek Supabase tidak sedang dijeda.
- **Login admin gagal**: pastikan akun dibuat dengan "Auto Confirm User" dan email/kata sandinya benar.
- **"function get_quiz ... does not exist"**: `supabase.sql` belum dijalankan sampai selesai. Jalankan ulang (aman diulang).
- **Hasil siswa kosong di mode coba-coba**: itu wajar, data tiap browser terpisah. Gunakan mode online.
- Unduh hasil kapan saja lewat tombol **Unduh CSV** (bisa dibuka di Excel) sebagai cadangan.
