export const getStoredVendor = () => {
    try {
        const savedProfile = localStorage.getItem("vendorProfile");
        const savedUser = localStorage.getItem("vendorUser");

        const vendorProfile = savedProfile ? JSON.parse(savedProfile) : null;
        const vendorUser = savedUser ? JSON.parse(savedUser) : null;

        // Extract Vendor Profile ObjectId (_id)
        const vendorId = vendorProfile?._id || vendorProfile?.id || null;

        return {
            vendorUser,
            vendorProfile,
            vendorId, 
            storeName: vendorProfile?.storeName || "Vendor Store",
            storeLogo: vendorProfile?.storeLogo || "",
            email: vendorUser?.email || ""
        };
    } catch (e) {
        console.error("Error reading vendor data from localStorage:", e);
        return {
            vendorUser: null,
            vendorProfile: null,
            vendorId: null,
            storeName: "Vendor Store",
            storeLogo: "",
            email: ""
        };
    }
};