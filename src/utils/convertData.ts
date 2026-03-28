export const getLinkImage = () => {
  return "https://storage.googleapis.com/my-app-storage-sigelo/profile/"
}

export const getDefaultProfileImg = () => {
  return "https://th.bing.com/th/id/OIP.x7NhF4R9aiHFO9r-i5X_eAHaHa?w=800&h=800&rs=1&pid=ImgDetMain"
}

export const getLinkImageByName = (name: string) : string => {
  if(name === getDefaultProfileImg()) {
    return getDefaultProfileImg()
  } else {
    return getLinkImage() + name
  }
  
}

export const getLinkFiles = (filename: String) => {
  const ext =  filename.split('.')[1] + '/';
  const url = "https://storage.googleapis.com/my-app-storage-sigelo/" + ext + filename

  return url;
}