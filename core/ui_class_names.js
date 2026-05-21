// This file defines a list of GUI element types that the WhatsApp Web page uses.
// The list can change in major WhatsApp Web updates. TODO: identify these dynamically based on React elements


// TODO: I need to think of a way to make this variable shared between ui.js and injected_ui.js !!
// currently it's a hack
var UIClassNames = {};

(function() {

     // Seems to be WhatsApp version 2.3000+, older GUI

     UIClassNames.MENU_ITEM_CLASS = "x1vqgdyp x100vrsf x1n2onr6 xt8t1vi x1xc408v x129tdwq x15urzxu xs723ss x1277o0a";
     UIClassNames.MENU_ITEM_INNER_CLASS = "html-button xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x178xt8z x1lun4ml xso031l xpilrb4 x1n2onr6 x1ejq31n x18oe1m7 x1sy0etr xstzfhl x1so62im x1syfmzz x1ja2u2z x1ypdohk x1s928wv x1j6awrg x4eaejv x1wsn0xg x1r0yslu x2q1x1w xapdjt xr6f91l x5rv0tg x1akc3lz xikp0eg x1xl5mkn x1mfml39 x1l5mzlr xgmdoj8 x1f1wgk5 x1x3ic1u xjbqb8w xy0j11r xg268so x1b4bgnk x1wb366y xtnn1bt x9v5kkp xmw7ebm xrdum7p x2lah0s x1lliihq xk8lq53 x9f619 xt8t1vi x1xc408v x129tdwq x15urzxu x1vqgdyp x100vrsf xhslqc4"; // inner button
     UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS = " x1fe8iih"; // you need to find the differences between the classes groups
     UIClassNames.OUTER_DROPDOWN_CLASS = "xu96u03 xm80bdy x10l6tqk x13vifvy xoz0ns6"; // outside class of dropdown with "mark as unread"
     UIClassNames.DROPDOWN_CLASS = "html-div xdj266r x14z9mp xat24cr x1lziwak xyri2b x1c1uobl x1tiyuxx x1nbhmlj";
     UIClassNames.DROPDOWN_ENTRY_CLASS = "html-button x13fuv20 x18b5jzi x1q0q8m5 x1t7ytsu xdj266r x14z9mp xat24cr x1lziwak xjbqb8w x972fbf x10w94by x1qhh985 x14e42zd x1ypdohk x1a2a7pz xexx8yu xyri2b x18d9i69 x1c1uobl x1yc453h xh8yej3 xtnn1bt x9v5kkp x784prv xlr9sxt xvvg52n xwd4zgb xq8v1ta xs2atcs xxxijta x14ug900 x20clwv";
     
     UIClassNames.UNREAD_COUNTER_CLASS = "xyp3urf"; // the span class that sets background-color to var(--unread-marker-background)
     
     UIClassNames.CHAT_PANEL_CLASS = "x9f619 x1n2onr6 xupqr0c x5yr21d x6ikm8r x10wlt62 x17dzmu4 x1i1dayz x2ipvbc xjdofhw xyyilfv x1iyjqo2"; // the outermost chat panel class (was used in the past for safety delay feature)
     UIClassNames.INNER_CHAT_PANEL_CLASS = "x10l6tqk x13vifvy x1o0tod xupqr0c x9f619 x78zum5 xdt5ytf xh8yej3 x5yr21d x6ikm8r x1rife3k xjbqb8w x1ewm37j"; // the innermost chat panel class ('conversation-panel-messages')
     
     UIClassNames.CHAT_ENTRY_CLASS = "x10l6tqk xh8yej3 x1g42fcv"; // the chat entry in the chats list
     UIClassNames.UNREAD_MARKER_CLASS = "x9f619 x1rg5ohu xq8v1hd xojvqvm x6ikm8r x10wlt62 xlyipyv xuxw1ft x1k43qru x1g83kfv x3qq2k7 x2x8art x1qor8vf x1iw51ew xde1mab xhsao0n"; // the "X unread messages" warning inside the chat panel; the class inside the top-level item
     UIClassNames.UNREAD_MARKER_CLASS_2 = "x1mnlqng"; // HACKKKKKKKK 
     UIClassNames.UNREAD_MARKER_CLASS_3 = "xhsao0n"; // HACKKKKK 2

     UIClassNames.GLOBAL_COLORS_CONTAINER_SELECTOR = ".x1h89ln0.x1h89ln0, .x1h89ln0.x1h89ln0:root"; // look for the selector in which the unread counter's color is defined
     
     UIClassNames.CHAT_MESSAGE = "messag-in";
     UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV = "_akbu x6ikm8r x10wlt62";

})();
