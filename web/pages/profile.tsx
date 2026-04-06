import { useState, useEffect, ChangeEvent, useRef } from "react";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  User,
  Search,
  Trash2,
  Edit,
  UploadCloud,
  Tag,
  CalendarDays,
  Loader2,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import {
  getCurrentProfile,
  updateProfile,
  removeAvatar,
  searchProfiles,
  type Profile,
} from "@/lib/profile";
import { supabase } from "@/lib/supabaseClient";
import Head from "next/head";

// A simple debounce hook to limit frequent search calls
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

const slideInLeft = {
  hidden: { opacity: 0, x: -50 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

// Helper function to get avatar URL with fallback
const getAvatarUrl = (profile: Profile | null | undefined): string => {
  if (!profile) return "";
  if (profile.avatar_url) return profile.avatar_url;
  // Generate a nice avatar from UI Avatars API using the user's name
  const name = profile.full_name || "User";
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=344966&color=fff&bold=true`;
};

// Avatar component with error handling
const ProfileAvatar = ({ profile, className }: { profile: Profile | null | undefined; className?: string }) => {
  const [imgError, setImgError] = useState(false);
  const avatarUrl = getAvatarUrl(profile);

  if (!profile) {
    return (
      <Avatar className={className}>
        <AvatarFallback>
          <User className="w-10 h-10" />
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <Avatar className={className}>
      {!imgError && avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          alt={profile.full_name || "User"}
          onError={() => setImgError(true)}
        />
      ) : null}
      <AvatarFallback>
        <User className="w-10 h-10" />
      </AvatarFallback>
    </Avatar>
  );
};

// FIXED: Direct avatar upload function with proper delete before upload
const uploadAvatarDirect = async (file: File, userId: string): Promise<string | null> => {
  console.log("📸 Starting avatar upload...");
  console.log("📸 File:", file.name, file.type, file.size);
  console.log("📸 User ID:", userId);
  
  if (!file) {
    console.error("❌ No file provided");
    toast.error("No file selected");
    return null;
  }

  // Check file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    console.error("❌ File too large:", file.size);
    toast.error("File too large. Maximum size is 5MB");
    return null;
  }

  // Check file type
  if (!file.type.startsWith('image/')) {
    console.error("❌ Invalid file type:", file.type);
    toast.error("Please select an image file");
    return null;
  }

  try {
    const fileName = `${userId}.jpg`;
    console.log("📸 Target filename:", fileName);

    // Check if file exists first
    const { data: existingFiles, error: listError } = await supabase.storage
      .from('avatars')
      .list('', {
        search: fileName,
        limit: 1,
      });
    
    console.log("📸 Existing files check:", existingFiles);
    
    // Try to delete old file if it exists
    if (existingFiles && existingFiles.length > 0) {
      console.log("📸 Old file found, attempting to delete...");
      const { error: deleteError } = await supabase.storage
        .from('avatars')
        .remove([fileName]);
      
      if (deleteError) {
        console.error("❌ Delete error:", deleteError);
      } else {
        console.log("✅ Old avatar deleted successfully");
      }
    } else {
      console.log("📸 No existing file found");
    }
    
    // Upload new file using upsert as fallback
    console.log("📸 Uploading new file...");
    const { error: uploadError, data: uploadData } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error("❌ Upload error details:", uploadError);
      toast.error(`Upload failed: ${uploadError.message}`);
      return null;
    }

    console.log("✅ Upload successful:", uploadData);

    const { data: publicUrlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(fileName);

    console.log("📸 Public URL:", publicUrlData.publicUrl);
    
    return publicUrlData.publicUrl;
  } catch (err) {
    console.error("❌ Unexpected error during upload:", err);
    toast.error("Unexpected error during upload");
    return null;
  }
};

// FIXED: Direct profile update function with maybeSingle()
const updateProfileDirect = async (userId: string, updates: {
  full_name?: string;
  avatar_url?: string | null;
  condition_tags?: string[];
}) => {
  console.log("📝 Updating profile directly with:", updates);
  
  const { data, error } = await supabase
    .from('user_profiles')
    .update({
      full_name: updates.full_name,
      avatar_url: updates.avatar_url,
      condition_tags: updates.condition_tags,
    })
    .eq('id', userId)
    .select()
    .maybeSingle();

  console.log("📝 Update result:", { data, error });

  if (error) {
    console.error("❌ Update error:", error);
    throw error;
  }

  console.log("✅ Update successful:", data);
  return data;
};

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [profileLoading, setProfileLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [conditionTags, setConditionTags] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const profileToDisplay = selectedProfile || profile;
  const [userEmail, setUserEmail] = useState<string>("");

  // FIXED: Proper profile fetching with maybeSingle() and correct loading state management
  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData?.user) {
        console.error("User not authenticated:", userError);
        setLoading(false);
        router.push("/auth/login");
        return;
      }

      console.log("USER:", userData.user);
      setUserEmail(userData.user.email || "");

      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching profile:", error);
        toast.error("Failed to load profile");
        setProfile(null);
        setLoading(false);
        return;
      }

      console.log("PROFILE:", data);

      if (!data) {
        // Create a profile if it doesn't exist
        console.warn("No profile found for user, creating one...");
        const newProfile = {
          id: userData.user.id,
          full_name: userData.user.email?.split('@')[0] || "User",
          avatar_url: null,
          condition_tags: [],
          created_at: new Date().toISOString(),
        };
        
        const { data: created, error: insertError } = await supabase
          .from("user_profiles")
          .insert(newProfile)
          .select()
          .single();
          
        if (insertError) {
          console.error("Error creating profile:", insertError);
          setProfile(null);
          setLoading(false);
          return;
        }
        
        setProfile(created);
        setFullName(created.full_name || "User");
        setConditionTags((created.condition_tags || []).join(", "));
        setLoading(false);
        return;
      }

      setProfile(data);
      setFullName(data.full_name || userData.user.email?.split('@')[0] || "User");
      setConditionTags((data.condition_tags || []).join(", "));
      setLoading(false);
    };

    fetchProfile();
  }, [router]);

  // FIXED: Search profiles with proper error handling
  useEffect(() => {
    const searchProfilesAsync = async () => {
      if (debouncedSearchQuery.trim() === "") {
        setSearchResults([]);
        return;
      }
      setSearchLoading(true);
      try {
        const results = await searchProfiles(debouncedSearchQuery.trim());
        setSearchResults(results);
      } catch (error: any) {
        console.error("Error searching profiles:", error);
        toast.error("Error searching profiles: " + error.message);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    };

    searchProfilesAsync();
  }, [debouncedSearchQuery]);

  /**
   * Handles the change event for the avatar file input
   */
  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log("📸 FILE SELECTED:", file?.name, file?.type, file?.size);
    if (file) {
      setAvatarFile(file);
    }
  };

  /**
   * Handles the form submission to update the profile
   */
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!profile) {
      console.log("❌ No profile found, cannot update");
      toast.error("Profile not found. Please refresh the page.");
      return;
    }
    
    setProfileLoading(true);
    
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      
      if (userError || !userData?.user) {
        throw new Error("User not authenticated: " + userError?.message);
      }

      console.log("📸 User ID for upload:", userData.user.id);

      let avatar_url = profile.avatar_url || null;
      
      if (avatarFile) {
        console.log("📸 Uploading new avatar...");
        const uploadedUrl = await uploadAvatarDirect(avatarFile, userData.user.id);
        
        if (uploadedUrl) {
          avatar_url = uploadedUrl;
          console.log("📸 Avatar uploaded successfully:", avatar_url);
        } else {
          console.error("❌ Upload returned null, keeping existing avatar");
          avatar_url = profile.avatar_url;
        }
      } else {
        console.log("📸 No new avatar file selected");
      }
      
      const tagsArray = conditionTags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag);
        
      console.log("📸 Updating profile with:", { fullName, avatar_url, tagsArray });
      
      const updatedProfile = await updateProfileDirect(userData.user.id, {
        full_name: fullName,
        avatar_url: avatar_url,
        condition_tags: tagsArray,
      });
      
      setProfile(updatedProfile);
      toast.success("Profile updated successfully!");
      setEditDialogOpen(false);
      setAvatarFile(null);
    } catch (error: any) {
      console.error("❌ Update error details:", error);
      toast.error("Error updating profile: " + error.message);
    } finally {
      setProfileLoading(false);
    }
  };

  /**
   * Handles the removal of the avatar
   */
  const handleRemoveAvatar = async () => {
    if (!profile) {
      console.log("❌ No profile found, cannot remove avatar");
      toast.error("Profile not found. Please refresh the page.");
      return;
    }
    
    setProfileLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        throw new Error("User not authenticated");
      }
      
      await removeAvatar();
      
      const updatedProfile = await updateProfileDirect(userData.user.id, {
        full_name: fullName,
        avatar_url: null,
        condition_tags: profile.condition_tags,
      });
      
      setProfile(updatedProfile);
      toast.success("Avatar removed successfully!");
      setEditDialogOpen(false);
    } catch (error: any) {
      toast.error("Error removing avatar: " + error.message);
    } finally {
      setProfileLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-12 w-12 text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <User className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">No Profile Found</h1>
          <p className="text-muted-foreground mb-6">
            We couldn't find your profile. Please try logging out and back in.
          </p>
          <Button onClick={() => router.push("/auth/login")} className="cursor-pointer">
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          SymptomSync |{" "}
          {profileToDisplay?.id === profile?.id
            ? "Your Profile"
            : `Viewing ${profileToDisplay?.full_name || "User"}'s Profile`}{" "}
        </title>
        <meta name="description" content="View and update your profile" />
      </Head>

      <div className="min-h-screen bg-background text-foreground p-4 sm:p-6">
        <style jsx global>{`
          html {
            scroll-behavior: smooth;
          }

          html,
          body {
            overscroll-behavior: none;
          }
        `}</style>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="max-w-4xl mx-auto space-y-8 pt-2 bg-background"
        >
          <motion.header
            variants={slideInLeft}
            className="text-center md:text-left"
          >
            <h1 className="text-3xl text-foreground font-bold">
              {profileToDisplay?.id === profile?.id
                ? "Your Profile 🙋‍♂️"
                : `Viewing ${profileToDisplay?.full_name || "User"}'s Profile 🧐`}
            </h1>
            <p className="text-lg text-foreground mt-1">
              {userEmail}
            </p>
          </motion.header>

          <motion.div variants={fadeInUp} className="mb-8">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="h-5 w-5 text-gray-400" />
              </span>
              <Input
                placeholder="Search profiles by name or email…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedProfile(null);
                }}
                className="pl-10 pr-4 py-2 w-full rounded-md border border-gray-300 cursor-pointer"
              />
              {searchLoading && (
                <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <Loader2 className="animate-spin h-5 w-5 text-gray-400" />
                </span>
              )}
            </div>
            {searchResults.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 border border-gray-300 rounded-md p-2 max-h-60 overflow-y-auto bg-white text-gray-900 shadow-lg"
              >
                {searchResults.slice(0, 5).map((usr) => (
                  <motion.li
                    key={usr.id}
                    className="p-2 cursor-pointer flex items-center space-x-3 rounded hover:bg-gray-200 transition-colors"
                    onClick={() => {
                      setSelectedProfile(usr);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                  >
                    <Avatar className="w-8 h-8">
                      {usr.avatar_url ? (
                        <AvatarImage
                          src={usr.avatar_url}
                          alt={usr.full_name || "User"}
                          onError={(e) => {
                            e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(usr.full_name || "User")}&background=344966&color=fff&bold=true`;
                          }}
                        />
                      ) : (
                        <AvatarFallback>
                          <User className="w-5 h-5 text-foreground" />
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <span className="font-medium truncate">
                      {usr.full_name || "User"}
                    </span>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="p-6 flex flex-col sm:flex-row items-center shadow-2xl rounded-xl bg-background gap-0 overflow-hidden">
              <ProfileAvatar profile={profileToDisplay} className="w-24 h-24" />
              <div className="mt-4 sm:mt-0 sm:ml-6 flex-1 text-left w-full">
                <h2 className="text-3xl font-bold truncate">
                  {profileToDisplay?.full_name || "Unnamed User"}
                </h2>
                <p className="text-md text-foreground truncate">
                  {userEmail}
                </p>
                <p className="text-sm text-foreground flex items-center mt-1 truncate">
                  <CalendarDays className="w-4 h-4 mr-1" /> Joined:{" "}
                  {profileToDisplay?.created_at
                    ? new Date(profileToDisplay.created_at).toLocaleDateString()
                    : "N/A"}
                </p>
                {(profileToDisplay?.condition_tags || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(profileToDisplay?.condition_tags || []).map(
                      (tag, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-secondary text-background rounded-full text-xs flex items-center truncate"
                        >
                          <Tag className="w-4 h-4 mr-1" /> {tag}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
              {profileToDisplay?.id === profile?.id && (
                <div className="mt-4 sm:mt-0">
                  <Button
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => setEditDialogOpen(true)}
                  >
                    <Edit className="w-4 h-4" /> Edit Profile
                  </Button>
                </div>
              )}
            </Card>

            {profileToDisplay?.id !== profile?.id && (
              <div className="mt-4 flex justify-center items-center">
                <Button
                  variant="outline"
                  className="mt-4 cursor-pointer"
                  onClick={() => {
                    setSelectedProfile(null);
                    setSearchQuery("");
                  }}
                >
                  <ChevronLeft className="w-4 h-4" /> Back to Your Profile
                </Button>
              </div>
            )}
          </motion.div>

          {profileToDisplay?.id === profile?.id && (
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
              <DialogContent className="bg-background p-8 rounded-xl shadow-2xl max-w-lg mx-auto">
                <DialogHeader>
                  <DialogTitle className="text-foreground">
                    Edit Your Profile
                  </DialogTitle>
                  <DialogDescription className="text-foreground">
                    Update your full name, avatar, and condition tags.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleUpdateProfile} className="space-y-6 mt-4">
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Avatar className="w-16 h-16">
                      {avatarFile ? (
                        <AvatarImage
                          src={URL.createObjectURL(avatarFile)}
                          alt="New Avatar"
                        />
                      ) : profileToDisplay?.avatar_url ? (
                        <AvatarImage
                          src={profileToDisplay.avatar_url}
                          alt={profileToDisplay.full_name || "User"}
                          onError={(e) => {
                            e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profileToDisplay?.full_name || "User")}&background=344966&color=fff&bold=true`;
                          }}
                        />
                      ) : (
                        <AvatarFallback>
                          <User className="w-8 h-8" />
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div className="flex-1">
                      <Label
                        htmlFor="avatar"
                        className="mb-1 block text-foreground"
                      >
                        Change Avatar
                      </Label>
                      <Input
                        type="file"
                        id="avatar"
                        accept="image/*"
                        onChange={handleAvatarChange}
                        className="border border-gray-300 rounded-md p-0 pl-2 h-8 flex items-center hover:bg-background cursor-pointer"
                      />
                      {profileToDisplay?.avatar_url && !avatarFile && (
                        <Button
                          variant="destructive"
                          onClick={handleRemoveAvatar}
                          className="mt-2 w-full sm:w-auto cursor-pointer"
                        >
                          <Trash2 className="mr-1 w-4 h-4" /> Remove Avatar
                        </Button>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="fullName" className="mb-2 text-foreground">
                      Full Name
                    </Label>
                    <Input
                      id="fullName"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full border border-gray-300 rounded-md p-2 cursor-pointer pl-4"
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="conditionTags"
                      className="mb-2 text-foreground"
                    >
                      Conditions (comma separated)
                    </Label>
                    <Input
                      id="conditionTags"
                      type="text"
                      value={conditionTags}
                      onChange={(e) => setConditionTags(e.target.value)}
                      placeholder="e.g., Diabetes, Hypertension"
                      className="w-full border border-gray-300 rounded-md p-2 cursor-pointer pl-4"
                    />
                  </div>
                  <DialogFooter className="mt-6 flex justify-end gap-4">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => setEditDialogOpen(false)}
                      className="hover:scale-105 transition-transform cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="hover:scale-105 transition-transform cursor-pointer"
                    >
                      <UploadCloud className="w-4 h-4" /> Save Changes
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </motion.div>
      </div>
    </>
  );
}