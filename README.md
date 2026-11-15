# Wibu Gallery

Wibu Gallery adalah galeri foto anime publik dengan tampilan mobile-first bergaya masonry yang terinspirasi dari pengalaman discovery visual, tetapi memakai identitas visual sendiri: hitam, ungu, dan silver.

## Fitur
- Beranda publik: semua foto member tampil dalam masonry 2 kolom di ponsel.
- Detail foto: Suka, Komentar, Bagikan, Simpan, menu tambahan, dan Download.
- Simpan: menyimpan foto ke tab **Disimpan** di profil Wibu Gallery, bukan ke galeri HP.
- Suka: masuk ke tab **Disukai**. Like dan Simpan merupakan dua tindakan terpisah.
- Download: mengunduh file gambar ke perangkat hanya ketika dipilih.
- Profil member: header sederhana dan hanya tiga tab — Disimpan, Disukai, Koleksi (foto yang diunggah sendiri).
- Pencarian foto berdasarkan judul, anime, karakter, dan nama member.
- Login/register Supabase; pengunjung dapat menjelajah tanpa login.
- Upload foto JPG/PNG/WEBP maksimal 10 MB.
- Tombol + berisi Up foto, Koleksi (album), dan Kolase (2–9 foto).
- Member dapat menghapus foto sendiri; Owner dapat menghapus semua foto.

## Setup
1. Buat project Supabase.
2. Buka SQL Editor dan jalankan seluruh isi `supabase.sql`.
   - Jika database versi sebelumnya sudah dipakai, backup dahulu. Script memakai `IF NOT EXISTS` dan menambahkan tabel interaksi serta kolom bio.
3. Buka `config.js` (file ini sudah disertakan) dan isi `SUPABASE_URL` serta `SUPABASE_ANON_KEY` dari Supabase Project Settings → API.
4. Pastikan `config.js` ikut di-commit / di-upload ke GitHub Pages. File ini sengaja tidak diabaikan oleh `.gitignore`; Supabase anon/publishable key memang digunakan di frontend dan wajib dilindungi dengan RLS.
5. Jangan pernah menaruh `service_role` key di frontend.
6. Deploy seluruh file ke hosting static seperti Netlify atau Vercel.

## Menjadikan akun sebagai Owner
Daftar akun terlebih dahulu, lalu jalankan SQL berikut dengan UUID akun sendiri:

```sql
update public.profiles set role = 'owner' where id = 'UUID-AKUN-KAMU';
```

## Catatan
- Semua orang dapat melihat foto yang diunggah ke bucket publik.
- Login dibutuhkan untuk upload, Like, Simpan, komentar, dan membuat album.
- Simpan hanya membuat bookmark di akun Wibu Gallery. Download adalah tindakan terpisah.
- Jumlah foto tidak dibatasi oleh aplikasi, tetapi tetap mengikuti kuota Storage dan bandwidth paket Supabase.
