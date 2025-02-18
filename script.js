// Supabase 클라이언트를 전역에서 사용하도록 설정
const SUPABASE_URL = "https://ilqlhkpicnmtkeoafboe.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlscWxoa3BpY25tdGtlb2FmYm9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MTY2MjcsImV4cCI6MjA1NTQ5MjYyN30.VOLhs73Ss17kZ2IGjdw8n5BQr-HogE8pMQ6FGSM9d1M";
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Supabase에서 발급받은 public URL을 Netlify 프록시용 상대 URL로 변환하는 함수
 * - Supabase URL 예시:
 *   https://ilqlhkpicnmtkeoafboe.supabase.co/storage/v1/render/image/public/uploads/파일명?width=800&quality=80
 * - 변환 후: /images/uploads/파일명?width=800&quality=80
 */
function getRelativeImageUrl(supabasePublicUrl) {
  // 만약 이미 상대 경로라면 그대로 반환
  if (!supabasePublicUrl.startsWith("http")) {
    return supabasePublicUrl;
  }
  try {
    const urlObj = new URL(supabasePublicUrl);
    // "/uploads/" 이후의 경로를 추출하여 "/images" 접두어와 결합
    const marker = "/uploads/";
    const idx = urlObj.pathname.indexOf(marker);
    if (idx === -1) return supabasePublicUrl;
    return "/images" + urlObj.pathname.substring(idx) + urlObj.search;
  } catch (err) {
    console.error("URL 변환 오류:", err);
    return supabasePublicUrl;
  }
}

/**
 * 영상 URL로부터 "중간 프레임" 썸네일을 생성하는 함수
 * - 데스크탑 브라우저에서 메타데이터 로드/시킹 문제를 방지하기 위해
 *   임시로 비디오를 DOM에 추가한 뒤, 썸네일을 생성하고 제거한다.
 * @param {string} videoUrl - 영상의 URL
 * @param {function} callback - 썸네일 dataURL을 반환할 콜백 함수
 */
function generateVideoThumbnail(videoUrl, callback) {
  const tempVideo = document.createElement("video");
  tempVideo.style.display = "none";
  document.body.appendChild(tempVideo);

  tempVideo.src = videoUrl;
  tempVideo.crossOrigin = "anonymous";
  tempVideo.preload = "metadata";
  tempVideo.muted = true;
  tempVideo.playsInline = true;

  tempVideo.addEventListener("loadedmetadata", function () {
    tempVideo.currentTime = tempVideo.duration / 2;
  });

  tempVideo.addEventListener("seeked", function () {
    const canvas = document.createElement("canvas");
    canvas.width = tempVideo.videoWidth;
    canvas.height = tempVideo.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
    const thumbnailDataUrl = canvas.toDataURL();

    document.body.removeChild(tempVideo);
    callback(thumbnailDataUrl);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  /* ---------- 모달 및 갤러리 관련 전역 변수 ---------- */
  let modalHistoryPushed = false;
  let modalTouchStartX = 0;
  let modalTouchStartY = 0;
  let modalInitialDistance = 0;
  let isPinching = false;
  let slideDisabledUntil = 0;
  let currentScale = 1.0;
  let currentIndex = 0;
  let currentPhotoRecord = null;
  let carouselSlides = [];
  let carouselTimer = null;
  const carouselInterval = 5000;
  let offset = 0;
  const limit = 32;

  /* ---------- 요소 선택 ---------- */
  const uploadBtn = document.getElementById("uploadBtn");
  const mainModal = document.getElementById("mainModal");
  const closeMainModal = document.getElementById("closeMainModal");
  const tabButtons = document.querySelectorAll(".tab-btn");
  const galleryTab = document.getElementById("galleryTab");
  const recTab = document.getElementById("recTab");
  const passwordInput = document.getElementById("password");
  const fileInput = document.getElementById("fileInput");
  const descriptionInput = document.getElementById("description");
  const submitBtn = document.getElementById("submitBtn");

  const recPasswordInput = document.getElementById("recPassword");
  const recFileInput = document.getElementById("recFileInput");
  const recDescriptionInput = document.getElementById("recDescription");
  const submitRecBtn = document.getElementById("submitRecBtn");
  const recList = document.getElementById("recList");

  const gallery = document.getElementById("gallery");
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  loadMoreBtn.innerHTML = "﹀";
  loadMoreBtn.style.display = "none";

  const imageModal = document.getElementById("imageModal");
  const modalImage = document.getElementById("modalImage");
  const imageDescription = document.getElementById("imageDescription");
  const closeImageBtn = document.getElementById("closeImageBtn");

  const openOptionBtn = document.getElementById("openOptionBtn");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  const carousel = document.getElementById("carousel");
  const prevCarousel = document.getElementById("prevCarousel");
  const nextCarousel = document.getElementById("nextCarousel");
  const carouselBg = document.getElementById("carousel-bg");

  // 추천 미디어 캐러셀 관련 변수
  let carouselIndex = 0;

  // 새 사진 옵션 모달 관련 요소
  const photoOptionsModal = document.getElementById("photoOptionsModal");
  const btnExitOptions = document.getElementById("btnExitOptions");
  const btnEditPhoto = document.getElementById("btnEditPhoto");
  const btnDeletePhoto = document.getElementById("btnDeletePhoto");

  // 수정 시 파일 변경용 숨김 파일 입력
  const editFileInput = document.getElementById("editFileInput");

  // 확대/축소 관련
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");

  /* ---------- Supabase Storage 관련 ---------- */
  // 참고: Netlify를 통한 프록시 적용을 위해, getPublicUrl 호출 시 transform 옵션을 적용한 후
  // 반환된 URL을 상대 URL (/images/...)로 변환합니다.
  // _redirects 파일 (public 폴더)에 아래 규칙을 추가하세요:
  // /images/*  https://ilqlhkpicnmtkeoafboe.supabase.co/storage/v1/render/image/public/:splat 200!

  /* ---------- Helper 함수: getRelativeImageUrl는 위에 정의됨 ---------- */

  /* ---------- 모달 닫기 공통 함수 ---------- */
  function closeModal(manual = false) {
    imageModal.style.display = "none";
    const modalVideo = document.getElementById("modalVideo");
    if (modalVideo) {
      modalVideo.pause();
      modalVideo.currentTime = 0;
    }
    if (manual && modalHistoryPushed) {
      modalHistoryPushed = false;
      history.back();
    }
    photoOptionsModal.style.display = "none";
  }

  window.addEventListener("popstate", function () {
    if (imageModal.style.display === "flex") {
      closeModal(false);
    }
  });

  /* ---------- 모달 및 탭 전환 ---------- */
  uploadBtn.addEventListener("click", function () {
    mainModal.style.display = "flex";
    activateTab("galleryTab");
  });
  closeMainModal.addEventListener("click", function () {
    mainModal.style.display = "none";
  });
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      const tabToActivate = this.getAttribute("data-tab");
      activateTab(tabToActivate);
    });
  });
  function activateTab(tabId) {
    if (tabId === "galleryTab") {
      galleryTab.style.display = "block";
      recTab.style.display = "none";
    } else {
      galleryTab.style.display = "none";
      recTab.style.display = "block";
      loadRecommendedList();
    }
    tabButtons.forEach((btn) => {
      btn.getAttribute("data-tab") === tabId
        ? btn.classList.add("active")
        : btn.classList.remove("active");
    });
  }

  /* ---------- Supabase Storage를 통한 갤러리 업로드 ---------- */
  submitBtn.addEventListener("click", async function () {
    const password = passwordInput.value;
    const description = descriptionInput.value.trim();
    if (password !== "AF50") {
      alert("비밀번호가 틀렸습니다!");
      return;
    }
    if (fileInput.files.length === 0) {
      alert("파일을 선택해주세요!");
      return;
    }
    const file = fileInput.files[0];
    const mediaType = file.type.startsWith("video/") ? "video" : "image";
    const filePath = `uploads/${Date.now()}_${file.name}`;
    const { error } = await supabaseClient.storage
      .from("images")
      .upload(filePath, file);
    if (error) {
      alert("업로드 중 오류가 발생했습니다: " + error.message);
      return;
    }
    // 이미지 최적화를 위해 transform 옵션 적용 (width:800, quality:80)
    const { data: urlData, error: urlError } = supabaseClient.storage
      .from("images")
      .getPublicUrl(filePath, {
        transform: {
          width: 800,
          quality: 80,
        },
      });
    if (urlError) {
      alert(
        "미디어 URL을 가져오는 중 오류가 발생했습니다: " + urlError.message
      );
      return;
    }
    // Netlify 프록시를 활용하기 위해 상대 URL로 변환
    const optimizedUrl =
      mediaType === "image"
        ? getRelativeImageUrl(urlData.publicUrl)
        : urlData.publicUrl;

    const { data: insertedData, error: insertError } = await supabaseClient
      .from("photos")
      .insert([{ url: optimizedUrl, description, media_type: mediaType }], {
        returning: "representation",
      });
    if (insertError) {
      alert(
        "미디어 정보를 저장하는 중 오류가 발생했습니다: " +
          (insertError.message || JSON.stringify(insertError))
      );
      return;
    }
    alert("업로드 완료!");
    const photoRecord = insertedData[0];
    const galleryItem = document.createElement("div");
    galleryItem.className = "gallery-item";

    if (mediaType === "video") {
      generateVideoThumbnail(urlData.publicUrl, function (thumbnailUrl) {
        const img = document.createElement("img");
        img.src = thumbnailUrl;
        img.setAttribute("data-description", description);
        img.setAttribute("data-id", photoRecord.id);
        img.setAttribute("data-media", "video");
        img.setAttribute("data-video-src", urlData.publicUrl);
        galleryItem.appendChild(img);
        gallery.insertBefore(galleryItem, gallery.firstChild);
      });
    } else {
      const img = document.createElement("img");
      img.src = optimizedUrl;
      img.setAttribute("data-description", description);
      img.setAttribute("data-id", photoRecord.id);
      img.setAttribute("data-media", "image");
      galleryItem.appendChild(img);
      gallery.insertBefore(galleryItem, gallery.firstChild);
    }
    mainModal.style.display = "none";
  });

  /* ---------- 갤러리 로드 ---------- */
  async function loadGallery() {
    const { data, error } = await supabaseClient
      .from("photos")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      console.error("갤러리 로드 오류:", error.message);
      return;
    }
    data.forEach((item) => {
      const galleryItem = document.createElement("div");
      galleryItem.className = "gallery-item";
      if (item.media_type === "video") {
        const videoUrl = item.url;
        generateVideoThumbnail(videoUrl, function (thumbnailUrl) {
          const img = document.createElement("img");
          img.src = thumbnailUrl;
          img.setAttribute(
            "data-description",
            item.description || "설명이 없습니다."
          );
          img.setAttribute("data-id", item.id);
          img.setAttribute("data-media", "video");
          img.setAttribute("data-video-src", videoUrl);
          galleryItem.appendChild(img);
          gallery.appendChild(galleryItem);
        });
      } else {
        const img = document.createElement("img");
        // 이미지의 경우 상대 URL로 변환해 사용 (이미 _redirects 규칙 적용)
        img.src = getRelativeImageUrl(item.url);
        img.setAttribute(
          "data-description",
          item.description || "설명이 없습니다."
        );
        img.setAttribute("data-id", item.id);
        img.setAttribute("data-media", "image");
        galleryItem.appendChild(img);
        gallery.appendChild(galleryItem);
      }
    });
    offset += limit;
    loadMoreBtn.style.display = data.length < limit ? "none" : "block";
  }
  loadMoreBtn.addEventListener("click", loadGallery);
  loadGallery();

  /* ---------- 갤러리 이미지/영상 확대 및 모달 처리 ---------- */
  gallery.addEventListener("click", function (e) {
    if (e.target.tagName === "IMG" || e.target.tagName === "VIDEO") {
      const galleryItems = Array.from(
        gallery.querySelectorAll(".gallery-item > *")
      );
      currentIndex = galleryItems.indexOf(e.target);
      openImageModal(currentIndex);
    }
  });
  function openImageModal(index, animate = false) {
    const galleryItems = Array.from(
      gallery.querySelectorAll(".gallery-item > *")
    );
    const targetMedia = galleryItems[index];
    if (!targetMedia) return;
    const mediaType =
      targetMedia.getAttribute("data-media") ||
      targetMedia.tagName.toLowerCase();
    currentPhotoRecord = {
      id: targetMedia.getAttribute("data-id"),
      url:
        mediaType === "video"
          ? targetMedia.getAttribute("data-video-src")
          : targetMedia.src,
      description:
        targetMedia.getAttribute("data-description") || "설명이 없습니다.",
      mediaType: mediaType,
      element: targetMedia.parentElement,
    };

    if (mediaType === "video") {
      let modalVideo = document.getElementById("modalVideo");
      if (!modalVideo) {
        modalVideo = document.createElement("video");
        modalVideo.id = "modalVideo";
        modalVideo.style.maxWidth = "100%";
        modalVideo.style.maxHeight = "80vh";
        modalVideo.controls = true;
        modalVideo.style.borderRadius = "8px";
        modalVideo.style.transition = "transform 0.2s ease, opacity 0.2s ease";
        modalVideo.addEventListener("play", function () {
          prevBtn.style.pointerEvents = "none";
          nextBtn.style.pointerEvents = "none";
          prevBtn.style.opacity = 0.3;
          nextBtn.style.opacity = 0.3;
        });
        modalVideo.addEventListener("pause", function () {
          prevBtn.style.pointerEvents = "";
          nextBtn.style.pointerEvents = "";
          prevBtn.style.opacity = "";
          nextBtn.style.opacity = "";
        });
        modalVideo.addEventListener("ended", function () {
          prevBtn.style.pointerEvents = "";
          nextBtn.style.pointerEvents = "";
          prevBtn.style.opacity = "";
          nextBtn.style.opacity = "";
        });
        imageModal
          .querySelector(".image-modal")
          .insertBefore(modalVideo, imageDescription);
      }
      modalImage.style.display = "none";
      modalVideo.style.display = "block";
      modalVideo.src = currentPhotoRecord.url;
      modalVideo.style.width = "100%";
      modalVideo.style.height = "auto";
      modalVideo.load();
      modalVideo.play();
    } else {
      let modalVideo = document.getElementById("modalVideo");
      if (modalVideo) modalVideo.style.display = "none";
      modalImage.style.display = "block";
      modalImage.src = currentPhotoRecord.url;
    }
    imageDescription.textContent = currentPhotoRecord.description;
    currentScale = 1.0;
    if (currentPhotoRecord.mediaType === "video") {
      let modalVideo = document.getElementById("modalVideo");
      if (modalVideo) modalVideo.style.transform = `scale(${currentScale})`;
    } else {
      modalImage.style.transform = `scale(${currentScale})`;
    }
    imageModal.style.display = "flex";
    if (!modalHistoryPushed) {
      history.pushState({ modalOpen: true }, "");
      modalHistoryPushed = true;
    }
  }

  /* ---------- 사진 옵션 모달: 사진 수정 기능 ---------- */
  btnEditPhoto.addEventListener("click", async function (e) {
    e.stopPropagation();
    const pwd = prompt("사진 수정을 위해 비밀번호를 입력하세요");
    if (pwd !== "AF50") {
      alert("비밀번호가 틀렸습니다!");
      return;
    }
    const newDescription = prompt(
      "새로운 사진 설명을 입력하세요",
      currentPhotoRecord.description
    );
    if (newDescription === null) return;
    if (editFileInput.files && editFileInput.files[0]) {
      const newFile = editFileInput.files[0];
      const mediaType = newFile.type.startsWith("video/") ? "video" : "image";
      const newFilePath = `uploads/${Date.now()}_${newFile.name}`;
      const { error: uploadError } = await supabaseClient.storage
        .from("images")
        .upload(newFilePath, newFile);
      if (uploadError) {
        alert("새 파일 업로드 중 오류 발생: " + uploadError.message);
        return;
      }
      const { data: urlData, error: urlError } = supabaseClient.storage
        .from("images")
        .getPublicUrl(newFilePath, {
          transform: {
            width: 800,
            quality: 80,
          },
        });
      if (urlError) {
        alert("새 미디어 URL을 가져오는 중 오류 발생: " + urlError.message);
        return;
      }
      const newUrl = newFile.type.startsWith("video/")
        ? urlData.publicUrl
        : getRelativeImageUrl(urlData.publicUrl);
      const { error: updateError } = await supabaseClient
        .from("photos")
        .update({
          url: newUrl,
          description: newDescription,
          media_type: mediaType,
        })
        .eq("id", currentPhotoRecord.id);
      if (updateError) {
        alert("사진 정보 업데이트 중 오류 발생: " + updateError.message);
        return;
      }
      const oldFilePath = getFilePathFromUrl(currentPhotoRecord.url);
      if (oldFilePath) {
        await supabaseClient.storage.from("images").remove([oldFilePath]);
      }
      alert("사진이 수정되었습니다!");
      currentPhotoRecord.url = newUrl;
      currentPhotoRecord.description = newDescription;
      currentPhotoRecord.mediaType = mediaType;
      if (currentPhotoRecord.mediaType === "video") {
        let modalVideo = document.getElementById("modalVideo");
        if (modalVideo) {
          modalVideo.src = newUrl;
          modalVideo.load();
        }
      } else {
        modalImage.src = newUrl;
      }
      imageDescription.textContent = newDescription;
      editFileInput.value = "";
    } else {
      const { error: updateError } = await supabaseClient
        .from("photos")
        .update({ description: newDescription })
        .eq("id", currentPhotoRecord.id);
      if (updateError) {
        alert("사진 설명 업데이트 중 오류 발생: " + updateError.message);
        return;
      }
      alert("사진 설명이 수정되었습니다.");
      currentPhotoRecord.description = newDescription;
      imageDescription.textContent = newDescription;
    }
  });

  /* ---------- 사진 옵션 모달: 사진 삭제 기능 ---------- */
  btnDeletePhoto.addEventListener("click", async function (e) {
    e.stopPropagation();
    const pwd = prompt("사진 삭제를 위해 비밀번호를 입력하세요");
    if (pwd !== "AF50") {
      alert("비밀번호가 틀렸습니다!");
      return;
    }
    if (!confirm("정말로 사진을 삭제하시겠습니까?")) return;
    const { error: delError } = await supabaseClient
      .from("photos")
      .delete()
      .eq("id", currentPhotoRecord.id);
    if (delError) {
      alert("사진 삭제 중 오류 발생: " + delError.message);
      return;
    }
    const filePath = getFilePathFromUrl(currentPhotoRecord.url);
    if (filePath) {
      await supabaseClient.storage.from("images").remove([filePath]);
    }
    alert("사진이 삭제되었습니다.");
    if (currentPhotoRecord.element) {
      currentPhotoRecord.element.remove();
    }
    closeModal(true);
  });

  /* ---------- 터치 이벤트 (슬라이드/핀치/모달 닫기) ---------- */
  imageModal.addEventListener("touchstart", function (e) {
    if (e.touches.length === 2) {
      modalInitialDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      isPinching = true;
    } else if (e.touches.length === 1) {
      modalTouchStartX = e.touches[0].clientX;
      modalTouchStartY = e.touches[0].clientY;
      isPinching = false;
    }
  });
  imageModal.addEventListener("touchmove", function (e) {
    if (e.touches.length === 2) {
      isPinching = true;
    }
  });
  imageModal.addEventListener("touchend", function (e) {
    if (currentPhotoRecord && currentPhotoRecord.mediaType === "video") {
      const modalVideo = document.getElementById("modalVideo");
      if (modalVideo && !modalVideo.paused) return;
    }
    if (isPinching) {
      slideDisabledUntil = Date.now() + 1000;
      isPinching = false;
      return;
    }
    if (Date.now() < slideDisabledUntil) return;
    let modalTouchEndX = e.changedTouches[0].clientX;
    let modalTouchEndY = e.changedTouches[0].clientY;
    let diffX = modalTouchStartX - modalTouchEndX;
    let diffY = modalTouchEndY - modalTouchStartY;
    if (diffY > 50 && diffY > Math.abs(diffX)) {
      closeModal(true);
      return;
    }
    if (Math.abs(diffX) > 50) {
      diffX > 0 ? nextBtn.click() : prevBtn.click();
    }
  });

  /* ---------- 확대/축소 버튼 동작 ---------- */
  zoomInBtn.addEventListener("click", function () {
    currentScale += 0.1;
    if (currentPhotoRecord.mediaType === "video") {
      let modalVideo = document.getElementById("modalVideo");
      if (modalVideo) modalVideo.style.transform = `scale(${currentScale})`;
    } else {
      modalImage.style.transform = `scale(${currentScale})`;
    }
  });
  zoomOutBtn.addEventListener("click", function () {
    if (currentScale > 0.3) {
      currentScale -= 0.1;
      if (currentPhotoRecord.mediaType === "video") {
        let modalVideo = document.getElementById("modalVideo");
        if (modalVideo) modalVideo.style.transform = `scale(${currentScale})`;
      } else {
        modalImage.style.transform = `scale(${currentScale})`;
      }
    }
  });

  closeImageBtn.addEventListener("click", function () {
    closeModal(true);
  });
  imageModal.addEventListener("click", function (e) {
    if (e.target === imageModal) {
      closeModal(true);
    }
  });

  /* ---------- 갤러리 내 이전/다음 버튼 ---------- */
  prevBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    const galleryItems = Array.from(
      gallery.querySelectorAll(".gallery-item > *")
    );
    currentIndex =
      (currentIndex - 1 + galleryItems.length) % galleryItems.length;
    openImageModal(currentIndex, true);
  });
  nextBtn.addEventListener("click", async function (e) {
    e.stopPropagation();
    let galleryItems = Array.from(
      gallery.querySelectorAll(".gallery-item > *")
    );
    if (currentIndex === galleryItems.length - 1) {
      await loadGallery();
      galleryItems = Array.from(gallery.querySelectorAll(".gallery-item > *"));
      if (currentIndex < galleryItems.length - 1) {
        currentIndex++;
      } else {
        alert("더 이상 미디어가 없습니다.");
        return;
      }
    } else {
      currentIndex++;
    }
    openImageModal(currentIndex, true);
  });

  /* ---------- 추천 미디어 관리 탭 ---------- */
  submitRecBtn.addEventListener("click", async function () {
    const password = recPasswordInput.value;
    const description = recDescriptionInput.value.trim();
    if (password !== "AF50") {
      alert("비밀번호가 틀렸습니다!");
      return;
    }
    if (recFileInput.files.length === 0) {
      alert("파일을 선택해주세요!");
      return;
    }
    const file = recFileInput.files[0];
    const mediaType = file.type.startsWith("video/") ? "video" : "image";
    const filePath = `uploads/${Date.now()}_${file.name}`;
    const { error } = await supabaseClient.storage
      .from("images")
      .upload(filePath, file);
    if (error) {
      alert("업로드 중 오류가 발생했습니다: " + error.message);
      return;
    }
    const { data: urlData, error: urlError } = supabaseClient.storage
      .from("images")
      .getPublicUrl(filePath, {
        transform: {
          width: 800,
          quality: 80,
        },
      });
    if (urlError) {
      alert(
        "미디어 URL을 가져오는 중 오류가 발생했습니다: " + urlError.message
      );
      return;
    }
    const optimizedUrl =
      mediaType === "image"
        ? getRelativeImageUrl(urlData.publicUrl)
        : urlData.publicUrl;
    const { error: insertError } = await supabaseClient
      .from("recommended")
      .insert([{ url: optimizedUrl, description, media_type: mediaType }]);
    if (insertError) {
      alert(
        "추천 미디어 정보를 저장하는 중 오류가 발생했습니다: " +
          (insertError.message || JSON.stringify(insertError))
      );
      return;
    }
    alert("추천 미디어 업로드 성공!");
    loadRecommendedList();
    loadRecommended();
  });

  async function loadRecommendedList() {
    const { data, error } = await supabaseClient
      .from("recommended")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("추천 미디어 목록 로드 오류:", error.message);
      return;
    }
    recList.innerHTML = "";
    if (data.length === 0) {
      recList.innerHTML = "<div>추천 미디어가 없습니다.</div>";
    } else {
      data.forEach((item) => {
        const recItem = document.createElement("div");
        recItem.className = "rec-item";
        let thumb;
        if (item.media_type === "video") {
          thumb = document.createElement("video");
          thumb.src = item.url;
          thumb.controls = true;
          thumb.style.width = "60px";
          thumb.style.height = "auto";
        } else {
          thumb = document.createElement("img");
          thumb.src = getRelativeImageUrl(item.url);
        }
        const info = document.createElement("span");
        info.textContent = item.description || "";
        const delBtn = document.createElement("button");
        delBtn.className = "rec-delete";
        delBtn.textContent = "삭제";
        delBtn.style.backgroundColor = "#f44336";
        delBtn.style.color = "white";
        delBtn.addEventListener("click", async function (e) {
          e.stopPropagation();
          const pwd = prompt("삭제를 위해 비밀번호를 입력하세요");
          if (pwd !== "AF50") {
            alert("비밀번호가 틀렸습니다!");
            return;
          }
          const { error: delError } = await supabaseClient
            .from("recommended")
            .delete()
            .eq("id", item.id);
          if (delError) {
            alert("삭제 중 오류가 발생했습니다: " + delError.message);
            return;
          }
          const filePath = getFilePathFromUrl(item.url);
          if (filePath) {
            await supabaseClient.storage.from("images").remove([filePath]);
          }
          alert("삭제되었습니다.");
          loadRecommendedList();
          loadRecommended();
        });
        recItem.appendChild(thumb);
        recItem.appendChild(info);
        recItem.appendChild(delBtn);
        recList.appendChild(recItem);
      });
    }
  }

  async function loadRecommended() {
    const { data, error } = await supabaseClient
      .from("recommended")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("추천 미디어 로드 오류:", error.message);
      return;
    }
    carousel.innerHTML = "";
    carouselSlides = [];
    if (data.length === 0) {
      carousel.innerHTML =
        '<div class="carousel-slide">추천 미디어가 없습니다.</div>';
      carouselSlides.push(document.querySelector(".carousel-slide"));
    } else {
      data.forEach((item) => {
        const slide = document.createElement("div");
        slide.className = "carousel-slide";
        let mediaElement;
        if (item.media_type === "video") {
          mediaElement = document.createElement("video");
          mediaElement.src = item.url;
          mediaElement.controls = true;
          mediaElement.style.width = "100%";
          mediaElement.style.height = "100%";
        } else {
          mediaElement = document.createElement("img");
          mediaElement.src = getRelativeImageUrl(item.url);
        }
        mediaElement.alt = item.description || "추천 미디어";
        mediaElement.addEventListener("click", function () {
          openRecommendedModal(item.url, item.description, item.media_type);
        });
        const delBtn = document.createElement("button");
        delBtn.className = "delete-rec";
        delBtn.textContent = "×";
        delBtn.style.backgroundColor = "#f44336";
        delBtn.style.color = "white";
        delBtn.addEventListener("click", async function (e) {
          e.stopPropagation();
          const pwd = prompt("삭제를 위해 비밀번호를 입력하세요");
          if (pwd !== "AF50") {
            alert("비밀번호가 틀렸습니다!");
            return;
          }
          const { error: delError } = await supabaseClient
            .from("recommended")
            .delete()
            .eq("id", item.id);
          if (delError) {
            alert("삭제 중 오류가 발생했습니다: " + delError.message);
            return;
          }
          const filePath = getFilePathFromUrl(item.url);
          if (filePath) {
            await supabaseClient.storage.from("images").remove([filePath]);
          }
          alert("삭제되었습니다.");
          loadRecommendedList();
          loadRecommended();
        });
        slide.appendChild(mediaElement);
        slide.appendChild(delBtn);
        carousel.appendChild(slide);
        carouselSlides.push(slide);
      });
    }
    carouselIndex = 0;
    updateCarousel();
    startCarouselAuto();
  }

  function updateCarousel() {
    const offsetX = -carouselIndex * 100;
    carousel.style.transform = `translateX(${offsetX}%)`;
    if (carouselSlides[carouselIndex]) {
      const currentMedia =
        carouselSlides[carouselIndex].querySelector("img, video");
      if (currentMedia) {
        carouselBg.style.backgroundImage = `url(${currentMedia.src})`;
      } else {
        carouselBg.style.backgroundImage = "";
      }
    } else {
      carouselBg.style.backgroundImage = "";
    }
  }
  function startCarouselAuto() {
    if (carouselTimer) clearInterval(carouselTimer);
    carouselTimer = setInterval(() => {
      if (carouselSlides.length === 0) return;
      carouselIndex = (carouselIndex + 1) % carouselSlides.length;
      updateCarousel();
    }, carouselInterval);
  }
  function resetCarouselAuto() {
    clearInterval(carouselTimer);
    startCarouselAuto();
  }
  prevCarousel.addEventListener("click", function () {
    if (carouselSlides.length === 0) return;
    carouselIndex =
      (carouselIndex - 1 + carouselSlides.length) % carouselSlides.length;
    updateCarousel();
    resetCarouselAuto();
  });
  nextCarousel.addEventListener("click", function () {
    if (carouselSlides.length === 0) return;
    carouselIndex = (carouselIndex + 1) % carouselSlides.length;
    updateCarousel();
    resetCarouselAuto();
  });
  let carouselTouchStartX = 0;
  let carouselTouchEndX = 0;
  carousel.addEventListener("touchstart", function (e) {
    carouselTouchStartX = e.touches[0].clientX;
  });
  carousel.addEventListener("touchend", function (e) {
    carouselTouchEndX = e.changedTouches[0].clientX;
    const diff = carouselTouchStartX - carouselTouchEndX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        carouselIndex = (carouselIndex + 1) % carouselSlides.length;
      } else {
        carouselIndex =
          (carouselIndex - 1 + carouselSlides.length) % carouselSlides.length;
      }
      updateCarousel();
      resetCarouselAuto();
    }
  });

  function openRecommendedModal(src, description, media_type) {
    if (media_type === "video") {
      let modalVideo = document.getElementById("modalVideo");
      if (!modalVideo) {
        modalVideo = document.createElement("video");
        modalVideo.id = "modalVideo";
        modalVideo.style.maxWidth = "100%";
        modalVideo.style.maxHeight = "80vh";
        modalVideo.controls = true;
        modalVideo.style.borderRadius = "8px";
        modalVideo.style.transition = "transform 0.2s ease, opacity 0.2s ease";
        imageModal
          .querySelector(".image-modal")
          .insertBefore(modalVideo, imageDescription);
      }
      modalImage.style.display = "none";
      modalVideo.style.display = "block";
      modalVideo.src = src;
      modalVideo.style.width = "100%";
      modalVideo.style.height = "auto";
      modalVideo.load();
      modalVideo.play();
    } else {
      let modalVideo = document.getElementById("modalVideo");
      if (modalVideo) modalVideo.style.display = "none";
      modalImage.style.display = "block";
      modalImage.src = src;
    }
    imageDescription.textContent = description || "설명이 없습니다.";
    currentPhotoRecord = {
      url: src,
      description: description,
      mediaType: media_type || "image",
    };
    currentScale = 1.0;
    if (currentPhotoRecord.mediaType === "video") {
      let modalVideo = document.getElementById("modalVideo");
      if (modalVideo) modalVideo.style.transform = `scale(${currentScale})`;
    } else {
      modalImage.style.transform = `scale(${currentScale})`;
    }
    imageModal.style.display = "flex";
    if (!modalHistoryPushed) {
      history.pushState({ modalOpen: true }, "");
      modalHistoryPushed = true;
    }
  }

  function getFilePathFromUrl(url) {
    const marker = "/uploads/";
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.substring(index + 1);
  }

  // 초기 추천 캐러셀 로드
  loadRecommended();
});
document.addEventListener("DOMContentLoaded", function () {
  const uploadPhotoLink = document.getElementById("uploadPhotoLink");
  const mainModal = document.getElementById("mainModal");

  uploadPhotoLink.addEventListener("click", function (event) {
    event.preventDefault();
    mainModal.style.display = "flex";
    activateTab("galleryTab");
  });
});
document.addEventListener("DOMContentLoaded", function () {
  const cactusButton = document.querySelector(".cactus");
  const trashbinButton = document.querySelector(".trashbin");
  const uploadButton = document.querySelector(".upload");
  const mainModal = document.getElementById("mainModal");

  cactusButton.addEventListener("click", function () {
    const userConfirmed = confirm("한재익 사이트로 이동");
    if (userConfirmed) {
      window.location.href = "https://cactusworld3.netlify.app/";
    }
  });

  trashbinButton.addEventListener("click", function () {
    const userConfirmed = confirm(
      "습작들과 업로드하기에는 애매한 것들을 올린 사이트로 이동"
    );
    if (userConfirmed) {
      window.location.href = "https://trashbin.netlify.app/";
    }
  });

  uploadButton.addEventListener("click", function () {
    mainModal.style.display = "flex";
    activateTab("galleryTab");
  });

  function activateTab(tabId) {
    const galleryTab = document.getElementById("galleryTab");
    const recTab = document.getElementById("recTab");
    const tabButtons = document.querySelectorAll(".tab-btn");

    if (tabId === "galleryTab") {
      galleryTab.style.display = "block";
      recTab.style.display = "none";
    } else {
      galleryTab.style.display = "none";
      recTab.style.display = "block";
    }
    tabButtons.forEach((btn) => {
      btn.getAttribute("data-tab") === tabId
        ? btn.classList.add("active")
        : btn.classList.remove("active");
    });
  }
});
gallery.addEventListener("click", function (e) {
  if (e.target.tagName === "IMG" || e.target.tagName === "VIDEO") {
    const galleryItems = Array.from(
      gallery.querySelectorAll(".gallery-item > *")
    );
    const clickedIndex = galleryItems.indexOf(e.target);

    // 갤러리 클릭 시 해당 이미지를 캐러셀에 추가 후 보여주기
    addImageToCarousel(e.target);
    carouselIndex = clickedIndex;
    updateCarousel();
    resetCarouselAuto();
  }
});
function addImageToCarousel(imageElement) {
  const carousel = document.getElementById("carousel");
  const slide = document.createElement("div");
  slide.className = "carousel-slide";

  const img = document.createElement("img");
  img.src = imageElement.src;
  img.alt = imageElement.getAttribute("data-description") || "Gallery Image";

  slide.appendChild(img);
  carousel.appendChild(slide);

  carouselSlides.push(slide);
  resetCarouselAuto();
}
