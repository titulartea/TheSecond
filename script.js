// Supabase 클라이언트를 전역에서 사용하도록 설정
const SUPABASE_URL = "https://ytshdqwlajmgvnzydjsu.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0c2hkcXdsYWptZ3ZuenlkanN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDIyMjcsImV4cCI6MjA4NzAxODIyN30.53y-EVUJ-yj8w7lZ_a2qDQ-cMcVeXmdphDmCcZZd59s";
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// Cloudinary 설정 (unsigned upload preset 사용)
const CLOUDINARY_CLOUD_NAME = "db9m1mtns";
const CLOUDINARY_UPLOAD_PRESET = "PEC_v2";

/**
 * Cloudinary에 파일을 업로드하고 URL을 반환하는 함수
 * @param {File} file - 업로드할 파일
 * @returns {Promise<string>} - 업로드된 파일의 secure_url
 */
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const resourceType = file.type.startsWith("video/") ? "video" : "image";
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    { method: "POST", body: formData }
  );
  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.error?.message || "Cloudinary 업로드 실패");
  }
  const data = await response.json();
  return data.secure_url;
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
  // 임시로 DOM에 추가 (데스크탑에서 메타데이터 로드/시킹 안정화)
  tempVideo.style.display = "none";
  document.body.appendChild(tempVideo);

  tempVideo.src = videoUrl;
  tempVideo.crossOrigin = "anonymous";
  tempVideo.preload = "metadata";
  tempVideo.muted = true;
  tempVideo.playsInline = true;

  // 메타데이터가 로드되면, 영상 중간 지점으로 이동
  tempVideo.addEventListener("loadedmetadata", function () {
    tempVideo.currentTime = tempVideo.duration / 2;
  });

  // 중간 지점으로 이동한 후, 캔버스에 그려서 썸네일 생성
  tempVideo.addEventListener("seeked", function () {
    const canvas = document.createElement("canvas");
    canvas.width = tempVideo.videoWidth;
    canvas.height = tempVideo.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
    const thumbnailDataUrl = canvas.toDataURL();

    // 작업이 끝나면 임시 비디오를 DOM에서 제거
    document.body.removeChild(tempVideo);

    // 콜백으로 썸네일 dataURL 반환
    callback(thumbnailDataUrl);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  /* ---------- 모달 관련 전역 변수 (모달 히스토리, 터치 좌표 등) ---------- */
  let modalHistoryPushed = false;
  let modalTouchStartX = 0;
  let modalTouchStartY = 0;
  let modalInitialDistance = 0;
  let isPinching = false;
  let slideDisabledUntil = 0;

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
  let carouselSlides = [];
  let carouselTimer = null;
  const carouselInterval = 5000;

  // 새 사진 옵션 모달 관련 요소
  const photoOptionsModal = document.getElementById("photoOptionsModal");
  const btnExitOptions = document.getElementById("btnExitOptions");
  const btnEditPhoto = document.getElementById("btnEditPhoto");
  const btnDeletePhoto = document.getElementById("btnDeletePhoto");

  // 수정 시 파일 변경용 숨김 파일 입력
  const editFileInput = document.getElementById("editFileInput");

  // 확대/축소 관련
  let currentScale = 1.0;
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");

  // 기타 변수
  let offset = 0;
  const limit = 32;
  let currentIndex = 0;
  let currentPhotoRecord = null;

  /* ---------- 모달 닫기 공통 함수 ---------- */
  function closeModal(manual = false) {
    imageModal.style.display = "none";
    const modalVideo = document.getElementById("modalVideo");
    if (modalVideo) {
      modalVideo.pause();
      modalVideo.currentTime = 0;
    }
    // 사용자가 직접 모달을 닫은 경우에만 히스토리 상태를 되돌림
    if (manual && modalHistoryPushed) {
      modalHistoryPushed = false;
      history.back();
    }
    // 옵션 모달도 함께 닫기
    photoOptionsModal.style.display = "none";
  }

  /* ---------- 브라우저 뒤로가기(popstate) 이벤트 (모바일 포함) ---------- */
  window.addEventListener("popstate", function (event) {
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
      loadRecGalleryPicker();
    }
    tabButtons.forEach((btn) => {
      btn.getAttribute("data-tab") === tabId
        ? btn.classList.add("active")
        : btn.classList.remove("active");
    });
  }

  /* ---------- 갤러리 업로드 (다중 파일 지원) ---------- */
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
    const files = Array.from(fileInput.files);
    const totalFiles = files.length;
    const progressDiv = document.getElementById("uploadProgress");
    const progressBar = document.getElementById("uploadProgressBar");
    const progressText = document.getElementById("uploadProgressText");
    progressDiv.style.display = "block";
    progressBar.style.width = "0%";
    progressText.textContent = `0 / ${totalFiles} 업로드 중...`;
    submitBtn.disabled = true;

    let successCount = 0;
    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      const mediaType = file.type.startsWith("video/") ? "video" : "image";
      // 첫 번째 파일에만 설명 적용, 나머지는 비움
      const desc = i === 0 ? description : "";
      let uploadedUrl;
      try {
        uploadedUrl = await uploadToCloudinary(file);
      } catch (err) {
        console.error(`파일 ${i + 1} 업로드 실패:`, err.message);
        continue;
      }
      const { data: insertedData, error: insertError } = await supabaseClient
        .from("photos")
        .insert([{ url: uploadedUrl, description: desc, media_type: mediaType }])
        .select();
      if (insertError || !insertedData || insertedData.length === 0) {
        console.error(`파일 ${i + 1} DB 저장 실패:`, insertError?.message);
        continue;
      }
      successCount++;
      const pct = Math.round(((i + 1) / totalFiles) * 100);
      progressBar.style.width = pct + "%";
      progressText.textContent = `${i + 1} / ${totalFiles} 업로드 중...`;

      const photoRecord = insertedData[0];
      const galleryItem = document.createElement("div");
      galleryItem.className = "gallery-item";
      if (mediaType === "video") {
        generateVideoThumbnail(uploadedUrl, function (thumbnailUrl) {
          const img = document.createElement("img");
          img.src = thumbnailUrl;
          img.setAttribute("data-description", desc);
          img.setAttribute("data-id", photoRecord.id);
          img.setAttribute("data-media", "video");
          img.setAttribute("data-video-src", uploadedUrl);
          galleryItem.appendChild(img);
          gallery.insertBefore(galleryItem, gallery.firstChild);
        });
      } else {
        const img = document.createElement("img");
        img.src = uploadedUrl;
        img.setAttribute("data-description", desc);
        img.setAttribute("data-id", photoRecord.id);
        img.setAttribute("data-media", "image");
        galleryItem.appendChild(img);
        gallery.insertBefore(galleryItem, gallery.firstChild);
      }
    }
    submitBtn.disabled = false;
    progressText.textContent = `완료! ${successCount}/${totalFiles}개 업로드 성공`;
    setTimeout(() => { progressDiv.style.display = "none"; }, 2000);
    if (successCount > 0) {
      alert(`${successCount}개 파일 업로드 완료!`);
    } else {
      alert("업로드에 실패했습니다.");
    }
    fileInput.value = "";
    mainModal.style.display = "none";
  });

  /* ---------- 갤러리 로드 (이미지/영상 공용) ---------- */
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

      // 영상이면 썸네일 생성, 이미지면 바로 표시
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
        img.src = item.url;
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
        // 재생 중에는 이전/다음 버튼 비활성화
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
    imageModal.style.display = "flex";

    // 모달 오픈 시 히스토리 상태 추가 (아직 추가되지 않았다면)
    if (!modalHistoryPushed) {
      history.pushState({ modalOpen: true }, "");
      modalHistoryPushed = true;
    }
  }

  /* ---------- 옵션 모달 열기/닫기 이벤트 추가 ---------- */
  openOptionBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    photoOptionsModal.style.display = "flex";
  });
  btnExitOptions.addEventListener("click", function (e) {
    e.stopPropagation();
    photoOptionsModal.style.display = "none";
  });

  /* ---------- 사진 옵션 모달: 사진 수정 기능 ---------- */
  btnEditPhoto.addEventListener("click", async function (e) {
    e.stopPropagation();

    // 비밀번호 확인
    const pwd = prompt("사진 수정을 위해 비밀번호를 입력하세요");
    if (pwd !== "AF50") {
      alert("비밀번호가 틀렸습니다!");
      return;
    }

    // 새 설명을 입력 (기존 설명을 기본값으로)
    const newDescription = prompt(
      "새로운 사진 설명을 입력하세요",
      currentPhotoRecord.description
    );
    if (newDescription === null) return; // 취소한 경우

    // 새 파일이 선택되었는지 확인 (파일이 선택되면 새 파일로 교체)
    if (editFileInput.files && editFileInput.files[0]) {
      const newFile = editFileInput.files[0];
      const mediaType = newFile.type.startsWith("video/") ? "video" : "image";

      // Cloudinary에 새 파일 업로드
      let newUrl;
      try {
        newUrl = await uploadToCloudinary(newFile);
      } catch (err) {
        alert("새 파일 업로드 중 오류 발생: " + err.message);
        return;
      }

      // 사진 레코드 업데이트 (파일 URL, 설명, 미디어 타입 모두 업데이트)
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

      alert("사진이 수정되었습니다!");

      // 현재 표시 내용 업데이트
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
      // 입력 필드 초기화
      editFileInput.value = "";
    } else {
      // 파일 변경 없이 설명만 업데이트하는 경우
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

    // 비밀번호 확인
    const pwd = prompt("사진 삭제를 위해 비밀번호를 입력하세요");
    if (pwd !== "AF50") {
      alert("비밀번호가 틀렸습니다!");
      return;
    }

    if (!confirm("정말로 사진을 삭제하시겠습니까?")) return;

    // 데이터베이스에서 사진 레코드 삭제
    const { error: delError } = await supabaseClient
      .from("photos")
      .delete()
      .eq("id", currentPhotoRecord.id);
    if (delError) {
      alert("사진 삭제 중 오류 발생: " + delError.message);
      return;
    }

    alert("사진이 삭제되었습니다.");

    // 갤러리에서 해당 사진 DOM 요소 제거
    if (currentPhotoRecord.element) {
      currentPhotoRecord.element.remove();
    }
    // 모달 닫기
    closeModal(true);
  });

  /* ---------- 터치 이벤트: 슬라이드와 핀치 구분, 아래로 스와이프 시 모달 닫기 ---------- */
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
    // 동영상 재생 중이면 슬라이드 전환 무시
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

    // 수직으로 50px 이상 내려갔고, 수평 이동보다 수직 이동이 더 큰 경우 모달 닫기
    if (diffY > 50 && diffY > Math.abs(diffX)) {
      closeModal(true);
      return;
    }

    // 가로 스와이프 (좌우 슬라이드 전환)
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

  /* ---------- 모달 닫을 때 동영상 재생 종료 ---------- */
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

  /* ---------- 추천 사진 관리 탭 (기존 갤러리에서 선택) ---------- */
  const recGalleryPicker = document.getElementById("recGalleryPicker");
  let selectedRecPhotos = []; // 선택된 갤러리 사진 id 배열

  // 추천 탭 열릴 때 갤러리 사진 목록을 피커에 표시
  async function loadRecGalleryPicker() {
    const { data, error } = await supabaseClient
      .from("photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("갤러리 로드 오류:", error.message);
      return;
    }
    recGalleryPicker.innerHTML = "";
    selectedRecPhotos = [];
    if (data.length === 0) {
      recGalleryPicker.innerHTML = "<p style='color:#999; font-size:12px;'>갤러리가 비어있습니다.</p>";
      return;
    }
    data.forEach((item) => {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:relative; cursor:pointer; border:2px solid transparent; border-radius:4px; overflow:hidden; aspect-ratio:1;";
      const img = document.createElement("img");
      img.src = item.url;
      img.style.cssText = "width:100%; height:100%; object-fit:cover;";
      img.alt = item.description || "";
      wrapper.appendChild(img);
      wrapper.addEventListener("click", function () {
        const idx = selectedRecPhotos.findIndex(p => p.id === item.id);
        if (idx >= 0) {
          selectedRecPhotos.splice(idx, 1);
          wrapper.style.borderColor = "transparent";
          wrapper.style.opacity = "1";
        } else {
          selectedRecPhotos.push(item);
          wrapper.style.borderColor = "#41a314";
          wrapper.style.opacity = "0.7";
        }
      });
      recGalleryPicker.appendChild(wrapper);
    });
  }

  submitRecBtn.addEventListener("click", async function () {
    const password = recPasswordInput.value;
    if (password !== "AF50") {
      alert("비밀번호가 틀렸습니다!");
      return;
    }
    if (selectedRecPhotos.length === 0) {
      alert("추천할 사진을 선택해주세요!");
      return;
    }
    const insertRows = selectedRecPhotos.map(p => ({
      url: p.url,
      description: p.description || "",
      media_type: p.media_type || "image",
    }));
    const { error: insertError } = await supabaseClient
      .from("recommended")
      .insert(insertRows);
    if (insertError) {
      alert("추천 사진 저장 중 오류: " + (insertError.message || JSON.stringify(insertError)));
      return;
    }
    alert(`${selectedRecPhotos.length}개 사진을 추천에 추가했습니다!`);
    selectedRecPhotos = [];
    loadRecommendedList();
    loadRecommended();
    loadRecGalleryPicker();
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
          thumb.src = item.url;
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
          mediaElement.src = item.url;
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

    // 모달 오픈 시 히스토리 상태 추가 (아직 추가되지 않았다면)
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
    event.preventDefault(); // Prevent default link behavior
    mainModal.style.display = "flex"; // Open the upload modal
    activateTab("galleryTab"); // Activate the gallery upload tab
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
    mainModal.style.display = "flex"; // Open the upload modal
    activateTab("galleryTab"); // Activate the gallery upload tab
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

    // Update the carousel to show the clicked image
    carouselIndex = clickedIndex;
    updateCarousel();
    resetCarouselAuto();
  }
});
// Add this function to handle adding images to the carousel
function addImageToCarousel(imageElement) {
  const carousel = document.getElementById("carousel");
  const slide = document.createElement("div");
  slide.className = "carousel-slide";

  const img = document.createElement("img");
  img.src = imageElement.src;
  img.alt = imageElement.getAttribute("data-description") || "Gallery Image";

  slide.appendChild(img);
  carousel.appendChild(slide);

  // Update carousel slides array and reset the carousel auto-scroll
  carouselSlides.push(slide);
  resetCarouselAuto();
}

// Modify the existing gallery click event listener
gallery.addEventListener("click", function (e) {
  if (e.target.tagName === "IMG" || e.target.tagName === "VIDEO") {
    const galleryItems = Array.from(
      gallery.querySelectorAll(".gallery-item > *")
    );
    const clickedIndex = galleryItems.indexOf(e.target);

    // Add the clicked image to the carousel
    addImageToCarousel(e.target);

    // Update the carousel to show the clicked image
    carouselIndex = clickedIndex;
    updateCarousel();
    resetCarouselAuto();
  }
});
// Add this function to handle adding images to the carousel
// script.js에 추가
document.addEventListener("DOMContentLoaded", function () {
  function wrapGalleryForMobile() {
    const gallery = document.getElementById("gallery");
    const main = document.querySelector("main");

    if (
      window.innerWidth <= 450 &&
      !gallery.parentElement.classList.contains("gallery_container")
    ) {
      const container = document.createElement("div");
      container.className = "gallery_container";
      gallery.parentNode.insertBefore(container, gallery);
      container.appendChild(gallery);
    } else if (
      window.innerWidth > 450 &&
      gallery.parentElement.classList.contains("gallery_container")
    ) {
      const container = gallery.parentElement;
      container.parentNode.insertBefore(gallery, container);
      container.remove();
    }
  }

  // 초기 실행
  wrapGalleryForMobile();

  // 리사이즈 이벤트 리스너
  window.addEventListener("resize", wrapGalleryForMobile);
});
