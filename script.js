(function(){
  "use strict";

  var CATEGORIES = [
    { key:"tops", label:"Tops" },
    { key:"bottoms", label:"Bottoms" },
    { key:"shoes", label:"Shoes" },
    { key:"outerwear", label:"Outerwear" },
    { key:"accessories", label:"Accessories" }
  ];

  var state = {
    items: [],
    fits: [],
    activeCategoryFilter: "all",
    selection: {},        // category -> item id, for Create a Fit
    fotd: null,           // current fit-of-the-day object {itemIds:[...]}
    editingId: null,      // id of item currently being edited, or null when adding new
    loaded: false
  };

  // ---------- localStorage helpers ----------
  function getStored(key, fallback){
    try{
      var stored = localStorage.getItem(key);
      if(stored){
        return JSON.parse(stored);
      }
      return fallback;
    }catch(e){
      console.error("Storage error", e);
      return fallback;
    }
  }

  function setStored(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      console.log("✓ Saved to localStorage:", key, value);
    }catch(e){
      console.error("Storage error", e);
    }
  }

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  // ---------- category icons (inline SVG, stroke style) ----------
  function categoryIcon(cat){
    var stroke = "currentColor";
    switch(cat){
      case "tops":
        return '<svg viewBox="0 0 24 24" fill="none" stroke="'+stroke+'" stroke-width="1.6"><path d="M8 3 4 6l1.5 3L8 8v13h8V8l2.5 1L20 6l-4-3-2 2h-4L8 3Z" stroke-linejoin="round"/></svg>';
      case "bottoms":
        return '<svg viewBox="0 0 24 24" fill="none" stroke="'+stroke+'" stroke-width="1.6"><path d="M6 3h12l1 6-2 12h-3l-2-9-2 9H7L5 9l1-6Z" stroke-linejoin="round"/></svg>';
      case "shoes":
        return '<svg viewBox="0 0 24 24" fill="none" stroke="'+stroke+'" stroke-width="1.6"><path d="M3 17c0-2 1.5-3 3-4l4-3 3 1 5-1 3 3v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" stroke-linejoin="round"/></svg>';
      case "outerwear":
        return '<svg viewBox="0 0 24 24" fill="none" stroke="'+stroke+'" stroke-width="1.6"><path d="M9 3 5 6l1 4-2 1v9h4v-6l1 6h6l1-6v6h4v-9l-2-1 1-4-4-3-2 2h-2L9 3Z" stroke-linejoin="round"/></svg>';
      case "accessories":
        return '<svg viewBox="0 0 24 24" fill="none" stroke="'+stroke+'" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M12 12v9M9 21h6"/></svg>';
      default:
        return '';
    }
  }

  function catLabel(cat){
    var c = CATEGORIES.find(function(c){ return c.key === cat; });
    return c ? c.label : cat;
  }

  function escapeHtml(str){
    return String(str||"").replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // ---------- rendering: visual for an item (image or colored placeholder) ----------
  function itemVisualHtml(item){
    if(item.imageUrl){
      return '<img src="'+escapeHtml(item.imageUrl)+'" alt="'+escapeHtml(item.name)+'" loading="lazy" referrerpolicy="no-referrer" data-fallback-cat="'+escapeHtml(item.category)+'" data-fallback-color="'+escapeHtml(item.color||'#EDEAE3')+'">';
    }
    return categoryIcon(item.category);
  }

  function visualStyle(item){
    var color = item.color || "#C9C2B4";
    return item.imageUrl ? "" : ('background:'+color+'22; color:'+color+';');
  }

  // Images with a broken/failing URL fall back to the category icon.
  // Done via a real DOM listener (not an inline onerror string) so SVG
  // markup with double quotes can never break out of an HTML attribute.
  function attachImageFallbacks(container){
    container.querySelectorAll("img[data-fallback-cat]").forEach(function(img){
      img.addEventListener("error", function(){
        var cat = img.getAttribute("data-fallback-cat");
        var color = img.getAttribute("data-fallback-color") || "#EDEAE3";
        var parent = img.parentElement;
        if(!parent) return;
        parent.innerHTML = categoryIcon(cat);
        parent.style.background = color + "22";
        parent.style.color = color;
      }, { once:true });
    });
  }

  // ============ CLOSET TAB ============
  function renderChips(){
    var chipsEl = document.getElementById("closet-chips");
    var cats = [{key:"all", label:"All"}].concat(CATEGORIES);
    chipsEl.innerHTML = cats.map(function(c){
      var active = state.activeCategoryFilter === c.key ? " active" : "";
      return '<button class="chip'+active+'" data-filter="'+c.key+'">'+c.label+'</button>';
    }).join("");
    chipsEl.querySelectorAll(".chip").forEach(function(btn){
      btn.addEventListener("click", function(){
        state.activeCategoryFilter = btn.getAttribute("data-filter");
        renderChips();
        renderClosetGrid();
      });
    });
  }

  function renderClosetGrid(){
    var el = document.getElementById("closet-content");
    var sub = document.getElementById("closet-count-sub");
    sub.textContent = state.items.length === 0
      ? "No items yet"
      : state.items.length + " item" + (state.items.length===1?"":"s") + " in your closet";

    var filtered = state.activeCategoryFilter === "all"
      ? state.items
      : state.items.filter(function(i){ return i.category === state.activeCategoryFilter; });

    if(state.items.length === 0){
      el.innerHTML = '<div class="empty"><p>Your closet is empty. Add your first piece of clothing to get started.</p><button class="btn accent" id="empty-add-btn">+ Add item</button></div>';
      var btn = document.getElementById("empty-add-btn");
      if(btn) btn.addEventListener("click", function(){
        state.editingId = null;
        resetFormFields();
        document.getElementById("add-form-title").textContent = "New item";
        document.getElementById("save-item-btn").textContent = "Save item";
        document.getElementById("cancel-edit-btn").style.display = "none";
        showAddForm(true);
      });
      return;
    }

    if(filtered.length === 0){
      el.innerHTML = '<div class="empty"><p>Nothing in this category yet.</p></div>';
      return;
    }

    el.innerHTML = '<div class="closet-grid">' + filtered.map(function(item){
      return '<div class="item-card" data-id="'+item.id+'" data-edit="'+item.id+'">'
        + '<button class="item-remove" data-remove="'+item.id+'" aria-label="Remove item">×</button>'
        + '<div class="item-visual" style="'+visualStyle(item)+'">'+itemVisualHtml(item)+'</div>'
        + '<div class="item-meta"><div class="item-name">'+escapeHtml(item.name)+'</div><div class="item-cat">'+catLabel(item.category)+'</div></div>'
        + '<div class="item-edit-hint">Click to edit</div>'
        + '</div>';
    }).join("") + '</div>';

    attachImageFallbacks(el);

    el.querySelectorAll("[data-edit]").forEach(function(card){
      card.addEventListener("click", function(){
        var id = card.getAttribute("data-edit");
        var item = state.items.find(function(i){ return i.id === id; });
        if(item) openEditForm(item);
      });
    });

    el.querySelectorAll("[data-remove]").forEach(function(btn){
      btn.addEventListener("click", function(e){
        e.stopPropagation();
        var id = btn.getAttribute("data-remove");
        state.items = state.items.filter(function(i){ return i.id !== id; });
        setStored("wardrobe:items", state.items);
        Object.keys(state.selection).forEach(function(cat){
          if(state.selection[cat] === id) delete state.selection[cat];
        });
        if(state.editingId === id){
          state.editingId = null;
          showAddForm(false);
        }
        renderAll();
      });
    });
  }

  function showAddForm(show){
    document.getElementById("add-form").style.display = show ? "grid" : "none";
  }

  // Tracks a newly uploaded photo for the form currently open.
  // undefined = no upload action taken this session (fall back to typed URL / existing item photo)
  // null      = user explicitly removed the photo
  // string    = a freshly uploaded, resized image as a data URL
  var pendingImageDataUrl;
  var editingOriginalImageUrl = null;

  function updatePhotoPreview(url, cat, color){
    var box = document.getElementById("photo-preview");
    if(url){
      box.innerHTML = '<img src="'+escapeHtml(url)+'" alt="" referrerpolicy="no-referrer" data-fallback-cat="'+escapeHtml(cat||"tops")+'" data-fallback-color="'+escapeHtml(color||"#EDEAE3")+'">';
      attachImageFallbacks(box);
      box.style.background = "";
    }else{
      box.innerHTML = categoryIcon(cat || "tops");
      box.style.background = (color || "#C9C2B4") + "22";
      box.style.color = color || "#C9C2B4";
    }
  }

  function currentPreviewUrl(){
    if(pendingImageDataUrl === null) return null;
    if(typeof pendingImageDataUrl === "string") return pendingImageDataUrl;
    var typed = document.getElementById("f-url").value.trim();
    if(typed) return typed;
    return state.editingId ? editingOriginalImageUrl : null;
  }

  function refreshPreview(){
    var cat = document.getElementById("f-cat").value;
    var color = document.getElementById("f-color").value;
    updatePhotoPreview(currentPreviewUrl(), cat, color);
  }

  function resizeImageFile(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(e){
        var img = new Image();
        img.onload = function(){
          var maxDim = 480;
          var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          try{
            resolve(canvas.toDataURL("image/jpeg", 0.78));
          }catch(err){
            reject(err);
          }
        };
        img.onerror = function(){ reject(new Error("Could not read that image")); };
        img.src = e.target.result;
      };
      reader.onerror = function(){ reject(new Error("Could not read that file")); };
      reader.readAsDataURL(file);
    });
  }

  document.getElementById("f-file").addEventListener("change", function(e){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    resizeImageFile(file).then(function(dataUrl){
      pendingImageDataUrl = dataUrl;
      document.getElementById("f-url").value = "";
      refreshPreview();
    }).catch(function(err){
      console.error(err);
      alert("Could not load that photo — try a different file.");
    });
  });

  document.getElementById("f-url").addEventListener("input", function(){
    if(pendingImageDataUrl !== null){ pendingImageDataUrl = undefined; }
    document.getElementById("f-file").value = "";
    refreshPreview();
  });

  document.getElementById("f-cat").addEventListener("change", refreshPreview);
  document.getElementById("f-color").addEventListener("input", refreshPreview);

  document.getElementById("clear-photo-btn").addEventListener("click", function(){
    pendingImageDataUrl = null;
    document.getElementById("f-file").value = "";
    document.getElementById("f-url").value = "";
    refreshPreview();
  });

  function resetFormFields(){
    document.getElementById("f-name").value = "";
    document.getElementById("f-cat").value = "tops";
    document.getElementById("f-color").value = "#35415C";
    document.getElementById("f-url").value = "";
    document.getElementById("f-file").value = "";
    pendingImageDataUrl = undefined;
    editingOriginalImageUrl = null;
    updatePhotoPreview(null, "tops", "#35415C");
  }

  function openEditForm(item){
    state.editingId = item.id;
    pendingImageDataUrl = undefined;
    editingOriginalImageUrl = item.imageUrl || null;
    document.getElementById("f-name").value = item.name;
    document.getElementById("f-cat").value = item.category;
    document.getElementById("f-color").value = item.color || "#35415C";
    // Only echo genuine links into the text field — an uploaded photo is a
    // long data URL and isn't meant to be hand-edited as text.
    document.getElementById("f-url").value = (item.imageUrl && item.imageUrl.indexOf("data:") !== 0) ? item.imageUrl : "";
    document.getElementById("f-file").value = "";
    document.getElementById("add-form-title").textContent = "Editing \"" + item.name + "\"";
    document.getElementById("save-item-btn").textContent = "Update item";
    document.getElementById("cancel-edit-btn").style.display = "inline-block";
    refreshPreview();
    showAddForm(true);
    document.getElementById("add-form").scrollIntoView({ behavior:"smooth", block:"center" });
    document.getElementById("f-name").focus();
  }

  function closeEditForm(){
    state.editingId = null;
    resetFormFields();
    document.getElementById("add-form-title").textContent = "New item";
    document.getElementById("save-item-btn").textContent = "Save item";
    document.getElementById("cancel-edit-btn").style.display = "none";
    showAddForm(false);
  }

  document.getElementById("toggle-add-form").addEventListener("click", function(){
    var form = document.getElementById("add-form");
    var visible = form.style.display === "grid";
    if(visible){
      closeEditForm();
    }else{
      state.editingId = null;
      resetFormFields();
      document.getElementById("add-form-title").textContent = "New item";
      document.getElementById("save-item-btn").textContent = "Save item";
      document.getElementById("cancel-edit-btn").style.display = "none";
      showAddForm(true);
    }
  });

  document.getElementById("cancel-edit-btn").addEventListener("click", function(){
    closeEditForm();
  });

  document.getElementById("save-item-btn").addEventListener("click", function(){
    var name = document.getElementById("f-name").value.trim();
    var category = document.getElementById("f-cat").value;
    var color = document.getElementById("f-color").value;

    if(!name){
      document.getElementById("f-name").focus();
      return;
    }

    var finalImageUrl = currentPreviewUrl();

    if(state.editingId){
      var idx = state.items.findIndex(function(i){ return i.id === state.editingId; });
      if(idx !== -1){
        state.items[idx] = Object.assign({}, state.items[idx], {
          name: name, category: category, color: color, imageUrl: finalImageUrl || null
        });
      }
    }else{
      var newItem = { id: uid(), name: name, category: category, color: color, imageUrl: finalImageUrl || null, createdAt: Date.now() };
      state.items.push(newItem);
    }

    setStored("wardrobe:items", state.items);
    closeEditForm();
    renderAll();
  });

  // ============ CREATE A FIT TAB ============
  function renderCreateTab(){
    var el = document.getElementById("create-content");

    if(state.items.length === 0){
      el.innerHTML = '<div class="empty"><p>Your closet is empty. Add some clothes before building a fit.</p><button class="btn accent" id="create-empty-btn">Go to Closet</button></div>';
      var b = document.getElementById("create-empty-btn");
      if(b) b.addEventListener("click", function(){ switchTab("closet"); });
      return;
    }

    var columnsHtml = CATEGORIES.map(function(cat){
      var catItems = state.items.filter(function(i){ return i.category === cat.key; });
      var body = catItems.length === 0
        ? '<div class="pick-empty-col">None yet</div>'
        : catItems.map(function(item){
            var selected = state.selection[cat.key] === item.id ? " selected" : "";
            return '<div class="pick-card'+selected+'" data-cat="'+cat.key+'" data-id="'+item.id+'">'
              + '<div class="pick-swatch" style="'+visualStyle(item)+'">'+itemVisualHtml(item)+'</div>'
              + '<span>'+escapeHtml(item.name)+'</span>'
              + '</div>';
          }).join("");
      return '<div class="fit-col"><div class="fit-col-title">'+cat.label+'</div><div class="fit-col-items">'+body+'</div></div>';
    }).join("");

    var selectedItems = Object.keys(state.selection).map(function(cat){
      return state.items.find(function(i){ return i.id === state.selection[cat]; });
    }).filter(Boolean);

    var previewHtml;
    if(selectedItems.length === 0){
      previewHtml = '<div class="empty" style="padding:24px;"><p style="margin:0;">Select pieces above to preview your fit here.</p></div>';
    }else{
      previewHtml = '<div class="fit-preview">'
        + '<div class="fit-preview-swatches">' + selectedItems.map(function(item){
            return '<div class="mini-swatch" title="'+escapeHtml(item.name)+'" style="'+visualStyle(item)+'">'+itemVisualHtml(item)+'</div>';
          }).join("") + '</div>'
        + '<div class="fit-preview-actions">'
        + '<input type="text" id="fit-name-input" placeholder="Name this fit…">'
        + '<button class="btn accent" id="save-fit-btn">Save fit</button>'
        + '<button class="btn secondary" id="clear-fit-btn">Clear</button>'
        + '</div></div>';
    }

    el.innerHTML = '<div class="fit-columns">' + columnsHtml + '</div>' + previewHtml;

    attachImageFallbacks(el);

    el.querySelectorAll(".pick-card").forEach(function(card){
      card.addEventListener("click", function(){
        var cat = card.getAttribute("data-cat");
        var id = card.getAttribute("data-id");
        if(state.selection[cat] === id){
          delete state.selection[cat];
        }else{
          state.selection[cat] = id;
        }
        renderCreateTab();
      });
    });

    var saveBtn = document.getElementById("save-fit-btn");
    if(saveBtn){
      saveBtn.addEventListener("click", function(){
        var nameInput = document.getElementById("fit-name-input");
        var name = (nameInput.value || "").trim() || "Untitled fit";
        var itemIds = Object.values(state.selection);
        var newFit = { id: uid(), name: name, itemIds: itemIds, createdAt: Date.now() };
        state.fits.unshift(newFit);
        setStored("wardrobe:fits", state.fits);
        state.selection = {};
        renderCreateTab();
        renderSavedTab();
      });
    }
    var clearBtn = document.getElementById("clear-fit-btn");
    if(clearBtn){
      clearBtn.addEventListener("click", function(){
        state.selection = {};
        renderCreateTab();
      });
    }
  }

  // ============ FIT OF THE DAY TAB ============
  function pickRandomFit(avoidIds){
    var picks = {};
    CATEGORIES.forEach(function(cat){
      var pool = state.items.filter(function(i){ return i.category === cat.key; });
      if(pool.length === 0) return;
      var choice = pool[Math.floor(Math.random() * pool.length)];
      picks[cat.key] = choice.id;
    });

    // try once more to avoid an exact repeat of the previous combo
    var ids = Object.values(picks).sort().join(",");
    var avoidStr = (avoidIds||[]).slice().sort().join(",");
    if(ids === avoidStr && Object.keys(picks).length > 1){
      var retryPicks = {};
      CATEGORIES.forEach(function(cat){
        var pool = state.items.filter(function(i){ return i.category === cat.key; });
        if(pool.length === 0) return;
        var choice = pool[Math.floor(Math.random() * pool.length)];
        retryPicks[cat.key] = choice.id;
      });
      return retryPicks;
    }
    return picks;
  }

  function renderFotdTab(){
    var el = document.getElementById("fotd-content");

    if(state.items.length === 0){
      el.innerHTML = '<div class="empty"><p>Add some clothes to your closet to get a daily fit suggestion.</p><button class="btn accent" id="fotd-empty-btn">Go to Closet</button></div>';
      var b = document.getElementById("fotd-empty-btn");
      if(b) b.addEventListener("click", function(){ switchTab("closet"); });
      return;
    }

    if(!state.fotd){
      state.fotd = pickRandomFit([]);
    }

    var picks = state.fotd;
    var rows = CATEGORIES.map(function(cat){
      var id = picks[cat.key];
      if(!id) return null;
      var item = state.items.find(function(i){ return i.id === id; });
      if(!item) return null;
      return '<div class="hang-tag-row">'
        + '<div class="mini-swatch" style="'+visualStyle(item)+'">'+itemVisualHtml(item)+'</div>'
        + '<div class="hang-tag-row-text"><div class="name">'+escapeHtml(item.name)+'</div><div class="cat">'+catLabel(cat.key)+'</div></div>'
        + '</div>';
    }).filter(Boolean).join("");

    var today = new Date();
    var dateStr = today.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });

    el.innerHTML = '<div class="fotd-stage">'
      + '<div class="hang-tag">'
      + '<div class="hang-tag-string"></div>'
      + '<div class="hang-tag-eyebrow">Todays pick</div>'
      + '<div class="hang-tag-date">'+dateStr+'</div>'
      + '<div class="hang-tag-list">'+ (rows || '<div class="pick-empty-col">Nothing to show</div>') +'</div>'
      + '</div>'
      + '<div class="fotd-actions">'
      + '<button class="btn accent" id="shuffle-btn">Shuffle</button>'
      + '<button class="btn secondary" id="save-fotd-btn">Save this fit</button>'
      + '</div>'
      + '</div>';

    attachImageFallbacks(el);

    document.getElementById("shuffle-btn").addEventListener("click", function(){
      var prevIds = Object.values(state.fotd || {});
      state.fotd = pickRandomFit(prevIds);
      renderFotdTab();
    });

    document.getElementById("save-fotd-btn").addEventListener("click", function(){
      var itemIds = Object.values(state.fotd);
      var newFit = { id: uid(), name: "Fit of the Day — " + dateStr, itemIds: itemIds, createdAt: Date.now() };
      state.fits.unshift(newFit);
      setStored("wardrobe:fits", state.fits);
      renderSavedTab();
      var saveBtn = document.getElementById("save-fotd-btn");
      saveBtn.textContent = "Saved ✓";
      saveBtn.disabled = true;
    });
  }

  // ============ SAVED FITS TAB ============
  function renderSavedTab(){
    var el = document.getElementById("saved-content");
    var sub = document.getElementById("saved-count-sub");
    sub.textContent = state.fits.length === 0
      ? "No saved fits yet"
      : state.fits.length + " saved fit" + (state.fits.length===1?"":"s");

    if(state.fits.length === 0){
      el.innerHTML = '<div class="empty"><p>You have not saved any fits yet. Build one in Create a Fit, or save today&#39;s suggestion.</p></div>';
      return;
    }

    el.innerHTML = '<div class="fits-grid">' + state.fits.map(function(fit){
      var items = fit.itemIds.map(function(id){ return state.items.find(function(i){ return i.id === id; }); }).filter(Boolean);
      var dateStr = new Date(fit.createdAt).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
      return '<div class="fit-card">'
        + '<button class="item-remove" data-remove-fit="'+fit.id+'" aria-label="Delete fit">×</button>'
        + '<div class="fit-card-name">'+escapeHtml(fit.name)+'</div>'
        + '<div class="fit-card-date">'+dateStr+'</div>'
        + '<div class="fit-card-swatches">' + items.map(function(item){
            return '<div class="mini-swatch" title="'+escapeHtml(item.name)+'" style="'+visualStyle(item)+'">'+itemVisualHtml(item)+'</div>';
          }).join("") + '</div>'
        + '</div>';
    }).join("") + '</div>';

    attachImageFallbacks(el);

    el.querySelectorAll("[data-remove-fit]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-remove-fit");
        state.fits = state.fits.filter(function(f){ return f.id !== id; });
        setStored("wardrobe:fits", state.fits);
        renderSavedTab();
      });
    });
  }

  // ============ TAB SWITCHING ============
  function switchTab(tab){
    document.querySelectorAll("nav.tabs button").forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    });
    document.querySelectorAll(".panel").forEach(function(panel){
      panel.classList.toggle("active", panel.id === "panel-" + tab);
    });
  }
  document.querySelectorAll("nav.tabs button").forEach(function(btn){
    btn.addEventListener("click", function(){ switchTab(btn.getAttribute("data-tab")); });
  });

  function renderAll(){
    renderChips();
    renderClosetGrid();
    renderCreateTab();
    renderFotdTab();
    renderSavedTab();
  }

  // ============ EXPORT / IMPORT ============
  document.getElementById("export-btn").addEventListener("click", function(){
    var payload = {
      type: "wardrobe-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      items: state.items,
      fits: state.fits
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = "wardrobe-backup-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  });

  document.getElementById("import-file").addEventListener("change", function(e){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(evt){
      var parsed;
      try{
        parsed = JSON.parse(evt.target.result);
      }catch(err){
        alert("That file doesn't look like a valid wardrobe backup.");
        e.target.value = "";
        return;
      }
      if(!parsed || !Array.isArray(parsed.items) || !Array.isArray(parsed.fits)){
        alert("That file doesn't look like a valid wardrobe backup.");
        e.target.value = "";
        return;
      }

      var mode = "merge";
      if(state.items.length > 0 || state.fits.length > 0){
        mode = confirm(
          "Replace your current closet with this backup?\n\n" +
          "OK = replace everything\nCancel = merge into your current closet"
        ) ? "replace" : "merge";
      }

      if(mode === "replace"){
        state.items = parsed.items;
        state.fits = parsed.fits;
      }else{
        var existingIds = new Set(state.items.map(function(i){ return i.id; }));
        parsed.items.forEach(function(item){
          if(!existingIds.has(item.id)){ state.items.push(item); }
        });
        var existingFitIds = new Set(state.fits.map(function(f){ return f.id; }));
        parsed.fits.forEach(function(fit){
          if(!existingFitIds.has(fit.id)){ state.fits.push(fit); }
        });
      }

      setStored("wardrobe:items", state.items);
      setStored("wardrobe:fits", state.fits);
      e.target.value = "";
      renderAll();
      alert("Backup loaded — " + parsed.items.length + " item(s) and " + parsed.fits.length + " fit(s) processed.");
    };
    reader.onerror = function(){
      alert("Could not read that file.");
    };
    reader.readAsText(file);
  });

  // ============ INIT ============
  function init(){
    var items = getStored("wardrobe:items", []);
    var fits = getStored("wardrobe:fits", []);
    state.items = items || [];
    state.fits = fits || [];
    state.loaded = true;
    console.log("Initialized with", state.items.length, "items and", state.fits.length, "fits");
    renderAll();
  }

  init();
})();
