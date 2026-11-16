const cfg=window.WIBU_CONFIG||{};
const configured=cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_URL.includes('YOUR_')&&!cfg.SUPABASE_ANON_KEY.includes('YOUR_');
const $=id=>document.getElementById(id);let sb=null,user=null,profile=null,profileView=null,items=[],saved=new Set(),liked=new Set(),current=null,authMode='login',profileTab='saved',collections=[],selectedAvatarFile=null,removeAvatarRequested=false;
const bucket='wallpapers';const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url=w=>sb.storage.from(bucket).getPublicUrl(w.storage_path).data.publicUrl;const avatarUrl=path=>path?sb.storage.from('profile-avatars').getPublicUrl(path).data.publicUrl:null;const isOwner=()=>profile?.role==='owner';
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2500)}
function showApp(){$('appView').classList.remove('hidden');const g=$('startupGate');if(g)g.classList.add('hidden')}
function openAuth(){location.href='login.html'}
async function enter(u){
  if(!u)return;
  user=u;
  let p=await sb.from('profiles').select('*').eq('id',u.id).maybeSingle();
  if(p.error)throw p.error;
  if(!p.data){
    const initialName=u.user_metadata?.display_name||u.email?.split('@')[0]||'Member';
    const created=await sb.from('profiles').insert({id:u.id,display_name:initialName,bio:'',role:'member'}).select('*').single();
    if(created.error)throw created.error;
    profile=created.data;
  }else profile=p.data;
  await loadPersonal();showApp();await loadGallery();goScreen('home');
}
async function loadPersonal(){saved.clear();liked.clear();if(!user)return;const [s,l]=await Promise.all([sb.from('saved_items').select('wallpaper_id').eq('user_id',user.id),sb.from('likes').select('wallpaper_id').eq('user_id',user.id)]);(s.data||[]).forEach(x=>saved.add(x.wallpaper_id));(l.data||[]).forEach(x=>liked.add(x.wallpaper_id))}
async function loadGallery(){const r=await sb.from('wallpapers').select('id,user_id,title,character_name,anime_title,description,storage_path,created_at').order('created_at',{ascending:false});if(r.error){toast(r.error.message);return}const p=await sb.from('profiles').select('id,display_name,avatar_path');const people=new Map((p.data||[]).map(x=>[x.id,x]));items=(r.data||[]).map(x=>({...x,member_name:people.get(x.user_id)?.display_name||'Member',member_avatar_path:people.get(x.user_id)?.avatar_path||null}));$('feedCount').textContent=`${items.length} karya`;renderFeed();renderProfile();if(current)refreshDetail()}
function card(w){const image=url(w);return `<article class="pin-card" data-open="${w.id}"><img loading="lazy" src="${image}" alt="${esc(w.title)}"><div class="pin-overlay"><span class="pin-title">${esc(w.title)}</span><button class="pin-save" data-save="${w.id}">${saved.has(w.id)?'Tersimpan':'Simpan'}</button></div><div class="pin-credit">${esc(w.member_name)}</div></article>`}
function renderGrid(id,list){const el=$(id);if(!el)return;el.innerHTML=list.length?list.map(card).join(''):'<div class="empty">Belum ada foto di sini.</div>';el.querySelectorAll('[data-open]').forEach(x=>x.onclick=e=>{if(!e.target.closest('[data-save]'))openDetail(x.dataset.open)});el.querySelectorAll('[data-save]').forEach(x=>x.onclick=e=>{e.stopPropagation();toggleSaved(x.dataset.save)})}
function renderFeed(){renderGrid('feedGrid',items);const q=$('searchInput')?.value?.toLowerCase().trim()||'';if($('searchGrid'))renderGrid('searchGrid',q?items.filter(w=>[w.title,w.anime_title,w.character_name,w.member_name].join(' ').toLowerCase().includes(q)):[])}
function renderProfile(){
 if(!$('profileGrid'))return;
 const target=profileView||profile,targetId=profileView?.id||user?.id;
 const name=target?.display_name||user?.email?.split('@')[0]||'Guest';
 $('profileName').textContent=name;$('profileHandle').textContent='@'+name.toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,22);
 const avatar=avatarUrl(target?.avatar_path);$('profileAvatar').innerHTML=avatar?`<img src="${esc(avatar)}" alt="Foto profil ${esc(name)}">`:(name[0]?.toUpperCase()||'W');$('profileBio').textContent=target?.bio||'Pecinta anime dan ilustrasi.';
 $('editProfile').classList.toggle('hidden',!user||targetId!==user.id);$('logoutBtn').classList.toggle('hidden',!user||targetId!==user.id);
 const mine=items.filter(w=>w.user_id===targetId);$('profileUploadCount').textContent=mine.length;
 $('profileSavedCount').textContent=targetId===user?.id?saved.size:'—';$('profileLikedCount').textContent=targetId===user?.id?liked.size:'—';
 let list=profileTab==='saved'?items.filter(w=>saved.has(w.id)):profileTab==='liked'?items.filter(w=>liked.has(w.id)):mine;
 if(targetId!==user?.id&&profileTab!=='uploads')list=[];
 renderGrid('profileGrid',list);
 if(targetId!==user?.id&&profileTab!=='uploads')$('profileGrid').innerHTML='<div class="empty">Tab ini hanya terlihat oleh pemilik profil.</div>';
 document.querySelectorAll('[data-profile-tab]').forEach(b=>b.classList.toggle('active',b.dataset.profileTab===profileTab));
}
async function openMemberProfile(id){
 if(id===user?.id){profileView=null;profileTab='saved';}
 else{const r=await sb.from('profiles').select('id,display_name,bio,avatar_path').eq('id',id).single();profileView=r.data||{id,display_name:'Member',bio:'',avatar_path:null};profileTab='uploads';}
 closeOverlay('moreSheet');$('detailView').classList.add('hidden');goScreen('profile');
}
function goScreen(name){['home','search','profile'].forEach(x=>$(`${x}Screen`).classList.toggle('hidden',x!==name));document.querySelectorAll('[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===name));if(name==='profile')renderProfile()}
function openDetail(id){current=items.find(w=>w.id===id);if(!current)return;refreshDetail();$('detailView').classList.remove('hidden');document.body.style.overflow='hidden'}
function refreshDetail(){if(!current)return;$('detailImage').src=url(current);$('detailImage').alt=current.title;$('detailTitle').textContent=current.title;$('detailDescription').textContent=[current.anime_title,current.character_name,current.description].filter(Boolean).join(' · ')||'Karya yang dibagikan di Wibu Gallery.';$('detailMember').textContent=current.member_name;const memberAvatar=avatarUrl(current.member_avatar_path);$('detailAvatar').innerHTML=memberAvatar?`<img src="${esc(memberAvatar)}" alt="">`:(current.member_name[0]?.toUpperCase()||'W');$('detailDate').textContent=new Date(current.created_at).toLocaleDateString('id-ID');$('likeBtn').innerHTML=`${liked.has(current.id)?'♥':'♡'} <span>${liked.has(current.id)?'Disukai':'Suka'}</span>`;$('saveBtn').textContent=saved.has(current.id)?'Tersimpan':'Simpan';$('deletePhoto').classList.toggle('hidden',!(user&&(user.id===current.user_id||isOwner())));$('morePreview').src=url(current);const related=items.filter(w=>w.id!==current.id).slice(0,6);renderGrid('relatedGrid',related)}
async function toggleSaved(id){if(!user){toast('Masuk dulu untuk menyimpan foto ke profil.');return openAuth()}if(saved.has(id)){const r=await sb.from('saved_items').delete().eq('user_id',user.id).eq('wallpaper_id',id);if(r.error)return toast(r.error.message);saved.delete(id);toast('Dihapus dari Disimpan.')}else{const r=await sb.from('saved_items').insert({user_id:user.id,wallpaper_id:id});if(r.error)return toast(r.error.message);saved.add(id);toast('Foto tersimpan di profil Wibu Gallery.')}renderFeed();renderProfile();if(current?.id===id)refreshDetail()}
async function toggleLike(){if(!user){toast('Masuk dulu untuk menyukai foto.');return openAuth()}const id=current.id;if(liked.has(id)){const r=await sb.from('likes').delete().eq('user_id',user.id).eq('wallpaper_id',id);if(r.error)return toast(r.error.message);liked.delete(id)}else{const r=await sb.from('likes').insert({user_id:user.id,wallpaper_id:id});if(r.error)return toast(r.error.message);liked.add(id)}refreshDetail();renderProfile()}
async function downloadCurrent(){if(!current)return;try{const response=await fetch(url(current));if(!response.ok)throw new Error('Gagal mengambil gambar');const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),a=document.createElement('a');a.href=objectUrl;a.download=(current.title||'wibu-gallery').replace(/[^a-z0-9-_]/gi,'-')+'.'+(blob.type.includes('png')?'png':blob.type.includes('webp')?'webp':'jpg');document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(objectUrl);toast('Gambar diunduh ke perangkat.')}catch(e){window.open(url(current),'_blank');toast('Gambar dibuka. Gunakan menu browser untuk mengunduh.')}}
async function uploadFile(f,title){if(!user){toast('Masuk dulu untuk mengunggah.');return openAuth()}if(!f)return;if(f.size>10*1024*1024)return toast('Ukuran maksimal 10 MB per foto.');if(!['image/jpeg','image/png','image/webp'].includes(f.type))return toast('Gunakan JPG, PNG, atau WEBP.');toast('Mengunggah foto...');const ext=f.name.split('.').pop().toLowerCase(),path=`${user.id}/${crypto.randomUUID()}.${ext}`;const up=await sb.storage.from(bucket).upload(path,f,{contentType:f.type});if(up.error)return toast(up.error.message);const ins=await sb.from('wallpapers').insert({user_id:user.id,title:(title||f.name.replace(/\.[^.]+$/,'')).slice(0,90)||'Karya baru',storage_path:path});if(ins.error){await sb.storage.from(bucket).remove([path]);return toast(ins.error.message)}toast('Foto berhasil diunggah ke beranda!');await loadGallery();goScreen('home')}
async function handleQuickPhoto(){await uploadFile($('quickPhotoInput').files[0]);$('quickPhotoInput').value=''}
async function makeCollage(){if(!user){toast('Masuk dulu untuk membuat kolase.');return openAuth()}$('plusMenu').classList.add('hidden');$('collageInput').value='';$('collageInput').click()}
async function handleCollage(){const fs=[...$('collageInput').files];if(fs.length<2||fs.length>9)return toast('Pilih 2 sampai 9 foto.');if(fs.some(f=>f.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type)))return toast('Pastikan semua foto JPG/PNG/WEBP dan maksimal 10 MB.');const cols=fs.length<=4?2:3,cell=600,rows=Math.ceil(fs.length/cols),canvas=document.createElement('canvas');canvas.width=cols*cell;canvas.height=rows*cell;const ctx=canvas.getContext('2d');ctx.fillStyle='#08080b';ctx.fillRect(0,0,canvas.width,canvas.height);for(let i=0;i<fs.length;i++){const im=new Image(),u=URL.createObjectURL(fs[i]);await new Promise((ok,no)=>{im.onload=ok;im.onerror=no;im.src=u});const sc=Math.max(cell/im.width,cell/im.height),w=im.width*sc,h=im.height*sc,x=i%cols*cell,y=Math.floor(i/cols)*cell;ctx.save();ctx.beginPath();ctx.rect(x,y,cell,cell);ctx.clip();ctx.drawImage(im,x+(cell-w)/2,y+(cell-h)/2,w,h);ctx.restore();URL.revokeObjectURL(u)}const blob=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',.9));if(blob){const f=new File([blob],'kolase-wibu.jpg',{type:'image/jpeg'});await uploadFile(f,prompt('Nama kolase:','Kolase anime favorit'))}}
async function openCollection(){if(!user){toast('Masuk dulu untuk membuat koleksi.');return openAuth()}$('plusMenu').classList.add('hidden');$('collectionName').value='';const mine=items.filter(w=>w.user_id===user.id);$('collectionPhotoChoices').innerHTML=mine.length?mine.map(w=>`<label><input type="checkbox" value="${w.id}"><span>${esc(w.title)}</span></label>`).join(''):'<p class="muted">Upload foto dulu agar bisa dimasukkan ke koleksi.</p>';$('collectionModal').classList.remove('hidden')}
async function saveCollection(){const name=$('collectionName').value.trim();if(!name)return toast('Isi nama koleksi.');const selected=[...$('collectionPhotoChoices').querySelectorAll('input:checked')].map(x=>x.value);const r=await sb.from('collections').insert({user_id:user.id,name}).select('id').single();if(r.error)return toast(r.error.message);if(selected.length){const a=await sb.from('collection_items').insert(selected.map(id=>({collection_id:r.data.id,wallpaper_id:id})));if(a.error)return toast(a.error.message)}$('collectionModal').classList.add('hidden');toast('Koleksi berhasil dibuat.')}
async function openComments(){if(!current)return;$('commentsView').classList.remove('hidden');await loadComments()}
async function loadComments(){const r=await sb.from('comments').select('id,body,user_id,created_at').eq('wallpaper_id',current.id).order('created_at');if(r.error){$('commentList').innerHTML='<p class="muted">Komentar belum tersedia. Jalankan SQL terbaru.</p>';return}const ids=[...new Set((r.data||[]).map(x=>x.user_id))];const p=ids.length?await sb.from('profiles').select('id,display_name').in('id',ids):{data:[]};const names=new Map((p.data||[]).map(x=>[x.id,x.display_name]));$('commentList').innerHTML=(r.data||[]).length?r.data.map(x=>`<div class="comment-item"><b>${esc(names.get(x.user_id)||'Member')}</b>${esc(x.body)}<small>${new Date(x.created_at).toLocaleString('id-ID')}</small></div>`).join(''):'<p class="muted">Belum ada komentar. Jadilah yang pertama!</p>'}
async function sendComment(e){e.preventDefault();if(!user){toast('Masuk dulu untuk berkomentar.');return openAuth()}const body=$('commentInput').value.trim();if(!body)return;const r=await sb.from('comments').insert({wallpaper_id:current.id,user_id:user.id,body});if(r.error)return toast(r.error.message);$('commentInput').value='';await loadComments()}
async function deleteCurrent(){if(!current||!user||!(isOwner()||current.user_id===user.id))return;if(!confirm('Hapus foto ini?'))return;const r=await sb.from('wallpapers').delete().eq('id',current.id);if(r.error)return toast(r.error.message);await sb.storage.from(bucket).remove([current.storage_path]);$('detailView').classList.add('hidden');current=null;toast('Foto dihapus.');await loadGallery()}
function previewAvatar(file){const box=$('avatarPreview');if(!box)return;if(file){const reader=new FileReader();reader.onload=()=>{box.innerHTML=`<img src="${reader.result}" alt="Pratinjau foto profil">`};reader.readAsDataURL(file)}else{const src=!removeAvatarRequested?avatarUrl(profile?.avatar_path):null;box.innerHTML=src?`<img src="${esc(src)}" alt="Foto profil">`:(profile?.display_name?.[0]?.toUpperCase()||'W')}}
async function saveProfile(){
  const display_name=$('editName').value.trim();
  if(!display_name)return toast('Nama tidak boleh kosong.');
  const bio=$('editBio').value.trim();
  let avatar_path=profile?.avatar_path||null;
  let uploadedPath=null;

  if(selectedAvatarFile){
    const ext=selectedAvatarFile.type==='image/png'?'png':selectedAvatarFile.type==='image/webp'?'webp':'jpg';
    uploadedPath=`${user.id}/avatar-${Date.now()}.${ext}`;
    const up=await sb.storage.from('profile-avatars').upload(uploadedPath,selectedAvatarFile,{contentType:selectedAvatarFile.type,upsert:false});
    if(up.error)return toast(`Gagal mengunggah foto profil: ${up.error.message}`);
    avatar_path=uploadedPath;
  }else if(removeAvatarRequested){
    avatar_path=null;
  }

  // Save through a narrowly scoped SECURITY DEFINER RPC. The SQL function
  // always derives the target row from auth.uid(), never from a client user id.
  const result=await sb.rpc('update_my_profile',{
    p_display_name:display_name,
    p_bio:bio,
    p_avatar_path:avatar_path
  });
  if(result.error){
    if(uploadedPath)await sb.storage.from('profile-avatars').remove([uploadedPath]);
    return toast(`Profil gagal disimpan: ${result.error.message}. Pastikan SQL update_my_profile sudah dijalankan di Supabase.`);
  }
  const savedRow=Array.isArray(result.data)?result.data[0]:result.data;
  if(!savedRow||savedRow.display_name!==display_name||savedRow.bio!==bio||((savedRow.avatar_path||null)!==(avatar_path||null))){
    if(uploadedPath)await sb.storage.from('profile-avatars').remove([uploadedPath]);
    return toast('Database belum mengonfirmasi perubahan profil. Coba lagi.');
  }

  const oldPath=profile?.avatar_path;
  profile=savedRow;
  if(oldPath&&oldPath!==avatar_path)await sb.storage.from('profile-avatars').remove([oldPath]);
  selectedAvatarFile=null;
  removeAvatarRequested=false;
  $('avatarInput').value='';
  $('editModal').classList.add('hidden');
  renderProfile();
  await loadGallery();
  toast('Profil berhasil disimpan permanen.');
}

function closeOverlay(id){$(id).classList.add('hidden')}
function bind(){

$('searchOpen').onclick=()=>goScreen('search');$('headerAdd').onclick=$('bottomAdd').onclick=()=>{if(!user){toast('Masuk dulu untuk mengunggah.');return openAuth()}$('plusMenu').classList.remove('hidden')};document.querySelectorAll('[data-screen]').forEach(b=>b.onclick=()=>{if(b.dataset.screen==='profile'&&!user){openAuth();return}if(b.dataset.screen==='profile'){profileView=null;profileTab='saved'}goScreen(b.dataset.screen)});$('logoutBtn').onclick=async()=>{try{localStorage.removeItem('wibu_guest_mode')}catch(e){}await sb.auth.signOut();location.replace('login.html')};document.querySelectorAll('[data-profile-tab]').forEach(b=>b.onclick=()=>{profileTab=b.dataset.profileTab;renderProfile()});$('searchInput').oninput=renderFeed;
$('plusUpload').onclick=()=>{$('plusMenu').classList.add('hidden');$('quickPhotoInput').value='';$('quickPhotoInput').click()};$('plusCollection').onclick=openCollection;$('plusCollage').onclick=makeCollage;$('quickPhotoInput').onchange=handleQuickPhoto;$('collageInput').onchange=handleCollage;$('saveCollection').onclick=saveCollection;
$('detailBack').onclick=()=>{$('detailView').classList.add('hidden');document.body.style.overflow=''};$('detailOwner').onclick=()=>openMemberProfile(current.user_id);$('likeBtn').onclick=toggleLike;$('saveBtn').onclick=()=>toggleSaved(current.id);$('commentOpen').onclick=openComments;$('shareBtn').onclick=async()=>{const link=location.href.split('#')[0]+'#photo='+current.id;try{if(navigator.share)await navigator.share({title:current.title,url:link});else{await navigator.clipboard.writeText(link);toast('Tautan disalin.')}}catch(e){}};$('detailMore').onclick=()=>{$('moreSheet').classList.remove('hidden')};$('downloadImage').onclick=downloadCurrent;$('copyLink').onclick=async()=>{const link=location.href.split('#')[0]+'#photo='+current.id;try{await navigator.clipboard.writeText(link);toast('Tautan disalin.')}catch(e){toast(link)}closeOverlay('moreSheet')};$('moreFollow').onclick=()=>openMemberProfile(current.user_id);$('addToCollection').onclick=()=>{closeOverlay('moreSheet');openCollection()};$('reportPhoto').onclick=async()=>{if(!user){toast('Masuk dulu untuk melaporkan foto.');return openAuth()}const reason=prompt('Alasan laporan foto ini:');if(!reason?.trim())return;const r=await sb.from('reports').insert({wallpaper_id:current.id,user_id:user.id,reason:reason.trim().slice(0,300)});if(r.error)return toast(r.error.message);toast('Laporan berhasil dikirim.');closeOverlay('moreSheet')};$('deletePhoto').onclick=deleteCurrent;
$('commentForm').onsubmit=sendComment;$('editProfile').onclick=()=>{if(!user)return openAuth();selectedAvatarFile=null;removeAvatarRequested=false;$('avatarInput').value='';$('editName').value=profile.display_name||'';$('editBio').value=profile.bio||'';previewAvatar(null);$('editModal').classList.remove('hidden')};$('avatarInput').onchange=()=>{const f=$('avatarInput').files[0];if(!f)return;if(!['image/jpeg','image/png','image/webp'].includes(f.type)){$('avatarInput').value='';return toast('Gunakan foto JPG, PNG, atau WEBP.')}if(f.size>5*1024*1024){$('avatarInput').value='';return toast('Ukuran foto profil maksimal 5 MB.')}selectedAvatarFile=f;removeAvatarRequested=false;previewAvatar(f)};$('removeAvatar').onclick=()=>{selectedAvatarFile=null;$('avatarInput').value='';removeAvatarRequested=true;previewAvatar(null)};$('saveProfile').onclick=saveProfile;
document.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>{const m={plus:'plusMenu',more:'moreSheet',comments:'commentsView',collection:'collectionModal',edit:'editModal'}[b.dataset.dismiss];closeOverlay(m)});
}
async function init(){
  const gateMessage=$('startupMessage'),gateLogin=$('startupLoginLink'),gateRetry=$('startupRetry');
  const setGate=(message,showLogin=false)=>{if(gateMessage)gateMessage.textContent=message;if(gateLogin)gateLogin.classList.toggle('hidden',!showLogin);if(gateRetry)gateRetry.classList.remove('hidden')};
  if(gateRetry)gateRetry.onclick=()=>location.reload();
  try{
    if(!configured){setGate('Konfigurasi Supabase belum terbaca. Periksa config.js.',true);return}
    if(!window.supabase?.createClient){setGate('Library Supabase gagal dimuat. Periksa koneksi internet lalu coba lagi.',true);return}
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        storage:window.localStorage,
        // Avoid a stuck Web Locks queue on some Android/mobile browsers.
        lock:async(_name,_timeout,fn)=>await fn()
      }
    });
    bind();
    const sessionResult=await Promise.race([
      sb.auth.getSession(),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Pemeriksaan sesi melewati 12 detik. Coba muat ulang atau buka halaman masuk.')),12000))
    ]);
    const {data,error}=sessionResult;
    if(error)throw error;
    if(data?.session?.user){await enter(data.session.user)}
    else{
      let guest=false;try{guest=localStorage.getItem('wibu_guest_mode')==='1'}catch(e){}
      if(guest){showApp();await loadGallery();goScreen('home')}
      else{location.replace('login.html');return}
    }
    sb.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){user=null;profile=null;profileView=null;saved.clear();liked.clear();location.replace('login.html')}});
  }catch(err){console.error('Wibu Gallery startup error:',err);setGate('Aplikasi gagal dimuat: '+(err?.message||'Kesalahan tidak diketahui')+'. Periksa koneksi dan konfigurasi Supabase.',true)}
}
init();
