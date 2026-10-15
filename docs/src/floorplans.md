# Images and Floor Plans

Sites and locations can hold any number of images. One of them can be marked
as the **floor plan**: it is shown on the detail page with areas that link to
other sites or locations and markers for racks and devices.

## Images

The **Images** section of a site or location shows its images as thumbnails.

- **Upload:** use **Upload images** or drop files onto the section. PNG and
  JPEG up to 10 MB each are accepted.
- **Open:** click a thumbnail to view the image. There you can edit its
  description, replace the file, mark it as the floor plan or delete it.
- **Replace:** the new file keeps the description, and on a floor plan all
  areas and markers stay where they are. Positions are stored relative to the
  image size, so use a file with the same layout and aspect ratio.

## Floor plan

**Use as floor plan** marks an image. A site or location has at most one floor
plan; marking another image, or **Stop using as floor plan**, clears the areas
and markers of the previous plan (you are asked before content is lost).

The plan is shown at the full page width:

- **Areas** link to another site or location. Clicking one opens its page at
  its own floor plan, so you can drill down from the site to a floor to a room.
- **Markers** show racks and devices. The tooltip names the object and its
  status; a click opens it.

Rack and device pages show **On floor plan of …**, and site and location pages
show **Linked from …** when an area on another plan links to them.

### Editing

**Edit floor plan** (requires the edit permission) switches the plan into
edit mode. Changes are saved together with **Save**; **Cancel** discards them.
Leaving the page with unsaved changes asks first.

- **Areas:** choose **Draw area**, drag a rectangle on the plan, then pick the
  site or location it links to. Select an area to move it, resize it by its
  corners, change its label (empty shows the target's name) or delete it. Each
  site or location can be linked once per plan, and not to the plan itself.
- **Racks and devices:** the side list holds the racks and devices that can be
  placed. Drag one onto the plan, or click it to place it in the center. Drag
  a marker to move it; **×** removes it.

What can be placed:

| Plan of     | Racks and devices                                     |
| ----------- | ----------------------------------------------------- |
| Site        | of that site                                          |
| Location    | in that location or any location below it            |

Each rack and device sits on at most one floor plan. Moving it to a site or
location outside the plan (also by moving its location elsewhere in the
hierarchy) removes its marker.

Users limited to one tenant only see and edit the areas and markers of that
tenant; the others stay untouched when they save.

## Deleting

Deleting a site or location deletes its images. If floor-plan data would go
with it (areas or markers on its own plan, or areas on other plans that link
to it), a second confirmation lists what is removed. The same applies to
deleting an image that is the floor plan and has areas or markers.
