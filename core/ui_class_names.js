// This file defines a list of GUI element types that the WhatsApp Web page uses.
// The list can change in major WhatsApp Web updates. TODO: identify these dynamically based on React elements

var UIClassNames = {};

(function() {

    // Seems to be WhatsApp version 2.3000+, older GUI

    UIClassNames.MENU_ITEM_CLASS = "x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 x1q0g3np x1cy8zhl x100vrsf x1vqgdyp xhgddhk xdxvlk3 x1fglp x1rp6h8o xg6i1s1 x1277o0a x13i9f1t xr9ek0c xjpr12u";
    UIClassNames.MENU_ITEM_INNER_CLASS = "xjb2p0i xk390pu x1heor9g x1ypdohk xjbqb8w x972fbf xcfux6l x1qhh985 xm0m39n xh8yej3 x1y1aw1k x1sxyh0 xwib8y2 xurb0ha"; // inner button
    UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS = "xw2npq5 xzs022t";
    
    UIClassNames.OUTER_DROPDOWN_CLASS = "_ak4w _ap4- _ap4_"; // outside class of dropdown with "mark as unread"
    UIClassNames.DROPDOWN_CLASS = "_ap4_";
    UIClassNames.DROPDOWN_ENTRY_CLASS = "_aj-r _aj-q _aj-_ _asi6 _ap51";
    
    UIClassNames.UNREAD_COUNTER_CLASS = "x18ba5f9"; // the class that sets background-color to var(--unread-marker-background)
    
    UIClassNames.CHAT_PANEL_CLASS = "x14yy4lh"; // the outermost chat panel class (was used in the past for safety delay feature)
    UIClassNames.INNER_CHAT_PANEL_CLASS = "x3psx0u"; // the innermost chat panel class ('conversation-panel-messages')
    
    UIClassNames.CHAT_ENTRY_CLASS = "x10l6tqk "; // the chat entry in the chats list
    UIClassNames.UNREAD_MARKER_CLASS = "_agtk"; // the "X unread messages" warning inside the chat panel; the class inside the top-level item
    UIClassNames.UNREAD_MARKER_CLASS_2 = "xqhmz9w";
    
    UIClassNames.CHAT_MESSAGE = "messag-in";
    UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV = "x1lliihq xh8yej3";

})();
